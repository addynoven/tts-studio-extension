/**
 * TTS Worker — Runs ONNX / Kokoro inference off the main thread.
 * Isolates heavy WASM/WebGPU compute from Chrome's extension message loop.
 */

const _origWorkerWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (args.some(a => typeof a === 'string' && a.includes('Unable to determine content-length'))) {
    return;
  }
  _origWorkerWarn.apply(console, args);
};

import { loadModel, generateAudio, type TTSResult } from './index.js';
import { configureWasmPaths } from './kokoro.js';

interface WorkerLoadPayload {
  model: string;
  useGPU?: boolean;
  wasmPaths?: string;
}

interface WorkerInferPayload {
  model: string;
  text: string;
  voice: string;
  speed: number;
}

interface WorkerTask {
  id: number;
  payload: WorkerInferPayload;
}

const queue: WorkerTask[] = [];
let busy = false;

self.onmessage = async (e: MessageEvent<{ id: number; type: string; [key: string]: unknown }>) => {
  const { id, type, ...payload } = e.data;

  if (type === 'load') {
    try {
      const { model, useGPU, wasmPaths } = payload as unknown as WorkerLoadPayload;
      configureWasmPaths(wasmPaths);
      await loadModel(model, null, useGPU !== false);
      self.postMessage({ type: 'loaded', id });
    } catch (err) {
      self.postMessage({ type: 'error', id, error: (err as Error).message });
    }
    return;
  }

  if (type === 'infer') {
    queue.push({ id, payload: payload as unknown as WorkerInferPayload });
    if (!busy) void processQueue();
    return;
  }

  if (type === 'clearQueue') {
    while (queue.length > 0) {
      const task = queue.shift()!;
      self.postMessage({ type: 'cancelled', id: task.id });
    }
    return;
  }
};

async function processQueue(): Promise<void> {
  if (queue.length === 0) {
    busy = false;
    return;
  }
  busy = true;
  const task = queue.shift()!;

  try {
    const { model, text, voice, speed } = task.payload;
    const result: TTSResult = await generateAudio(model, text, voice, speed);
    self.postMessage({ type: 'result', id: task.id, ...result });
  } catch (err) {
    self.postMessage({ type: 'error', id: task.id, error: (err as Error).message });
  }

  void processQueue();
}
