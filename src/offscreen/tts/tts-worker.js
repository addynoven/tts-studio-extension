/**
 * TTS Worker — Runs ONNX inference off the main thread.
 *
 * The offscreen document sends `load` / `infer` messages.
 * We load models on demand, queue inference requests, and post back results.
 * This isolates heavy WASM compute from Chrome's extension message loop.
 */

import { loadModel, generateAudio } from './index.js';

const queue = [];
let busy = false;

self.onmessage = async (e) => {
  const { id, type, ...payload } = e.data;

  if (type === 'load') {
    // Load is synchronous-ish (we await inside)
    try {
      await loadModel(payload.model, null, payload.useGPU);
      self.postMessage({ type: 'loaded', id });
    } catch (err) {
      self.postMessage({ type: 'error', id, error: err.message });
    }
    return;
  }

  if (type === 'infer') {
    queue.push({ id, payload });
    if (!busy) processQueue();
    return;
  }
};

async function processQueue() {
  if (queue.length === 0) {
    busy = false;
    return;
  }
  busy = true;
  const { id, payload } = queue.shift();

  try {
    const { model, text, voice, speed } = payload;
    const result = await generateAudio(model, text, voice, speed);
    // Clone instead of transfer — avoids potential view corruption
    self.postMessage({ type: 'result', id, ...result });
  } catch (err) {
    self.postMessage({ type: 'error', id, error: err.message });
  }

  // Continue with next request
  processQueue();
}
