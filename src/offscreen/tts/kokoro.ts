/**
 * Kokoro-82M Neural Engine (WebGPU / WASM).
 * Runs Kokoro-82M locally in the browser via kokoro-js (ONNX Runtime Web).
 * 100% offline, privacy-first, producing 24kHz studio-grade neural speech.
 */

import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';
import type { TTSResult } from './kitten.js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let kokoroInstance: KokoroTTS | null = null;
let currentDevice: 'webgpu' | 'wasm' = 'webgpu';

/**
 * Configure transformers.js to load wasm/jsep runtime locally from the extension bundle.
 * This satisfies Chrome Extension Manifest V3 CSP ('script-src self wasm-unsafe-eval').
 */
export function configureWasmPaths(customPath?: string): void {
  let wasmDir = customPath;
  if (!wasmDir) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      wasmDir = chrome.runtime.getURL('transformers/');
    } else if (typeof self !== 'undefined' && self.location?.origin) {
      wasmDir = self.location.origin + '/transformers/';
    } else {
      wasmDir = 'transformers/';
    }
  }
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = wasmDir;
    env.backends.onnx.wasm.proxy = false;
    if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
      env.backends.onnx.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency);
    }
  }
  if (env.backends?.onnx) {
    env.backends.onnx.logLevel = 'error';
    if (env.backends.onnx.webgpu) {
      Object.assign(env.backends.onnx.webgpu, { powerPreference: 'high-performance' });
    }
  }
  (env as unknown as { webgpu: { powerPreference: string } }).webgpu = {
    powerPreference: 'high-performance'
  };
  env.allowLocalModels = false;
}

let activeTensorsToDispose: Array<{ dispose?: () => void }> = [];

/**
 * Intercepts Kokoro's underlying ONNX model execution to capture input and output tensors
 * so they can be explicitly disposed immediately after audio extraction.
 * This prevents WebGPU buffer leakage and Vulkan VK_ERROR_OUT_OF_DEVICE_MEMORY.
 */
function hookKokoroModel(instance: KokoroTTS): void {
  const model = (instance as unknown as {
    model?: {
      _call?: (inputs: Record<string, unknown>) => Promise<Record<string, unknown>>;
      _isDisposalHooked?: boolean;
    };
  }).model;

  if (!model || typeof model._call !== 'function' || model._isDisposalHooked) return;

  const origCall = model._call;
  model._call = async function (modelInputs: Record<string, unknown>) {
    if (modelInputs && typeof modelInputs === 'object') {
      for (const val of Object.values(modelInputs)) {
        if (val && typeof (val as { dispose?: () => void }).dispose === 'function') {
          activeTensorsToDispose.push(val as { dispose?: () => void });
        }
      }
    }
    const output = await origCall.apply(this, [modelInputs]);
    if (output && typeof output === 'object') {
      for (const val of Object.values(output)) {
        if (val && typeof (val as { dispose?: () => void }).dispose === 'function') {
          activeTensorsToDispose.push(val as { dispose?: () => void });
        }
      }
    }
    return output;
  };

  model._isDisposalHooked = true;
}

export interface WordTiming {
  word: string;
  charIndex: number;
  charLength: number;
  startTime: number;
  endTime: number;
}

export interface KokoroResult extends TTSResult {
  duration?: number;
  wordTimings?: WordTiming[];
}

/**
 * Load Kokoro-82M model.
 * WebGPU acceleration uses dtype: 'fp32' to ensure 100% mathematical precision and eliminate
 * the known ONNX Runtime WebGPU q8 ConvTranspose vocoder distortion.
 * On modern GPUs (like RTX 3060), fp32 executes in <100ms per sentence with studio quality.
 * If WebGPU is unavailable or unsupported, it cleanly falls back to WASM with dtype: 'q8'.
 */
export async function loadKokoro(
  onProgress?: ((pct: number) => void) | null,
  useGPU = true
): Promise<void> {
  if (kokoroInstance) return;

  configureWasmPaths();

  const targetDevice = useGPU ? 'webgpu' : 'wasm';
  const targetDtype = targetDevice === 'webgpu' ? 'fp32' : 'q8';

  try {
    kokoroInstance = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: targetDtype,
      device: targetDevice,
      progress_callback: (progress: { status: string; progress?: number }) => {
        if (onProgress && typeof progress.progress === 'number') {
          onProgress(Math.round(progress.progress * 100));
        }
      }
    });
    hookKokoroModel(kokoroInstance);
    currentDevice = targetDevice;
  } catch (err) {
    if (targetDevice === 'webgpu') {
      console.warn('[KokoroTTS] WebGPU failed, falling back to WASM q8:', err);
      kokoroInstance = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (progress: { status: string; progress?: number }) => {
          if (onProgress && typeof progress.progress === 'number') {
            onProgress(Math.round(progress.progress * 100));
          }
        }
      });
      hookKokoroModel(kokoroInstance);
      currentDevice = 'wasm';
    } else {
      throw err;
    }
  }
}

/**
 * Generate audio and word timings from text using Kokoro-82M.
 */
export async function generateKokoro(
  text: string,
  voice = 'af_heart',
  speed = 1.0
): Promise<KokoroResult> {
  if (!kokoroInstance) {
    await loadKokoro(null, true);
  }

  if (!kokoroInstance) {
    throw new Error('Failed to initialize KokoroTTS');
  }

  activeTensorsToDispose = [];

  try {
    const rawAudio = await kokoroInstance.generate(text, {
      voice: voice as unknown as Parameters<typeof kokoroInstance.generate>[1] extends { voice?: infer V } ? V : never,
      speed
    });

    const sampleRate = rawAudio.sampling_rate || 24000;
    // Detach and clone audio data into a new Float32Array in CPU memory before GPU tensor disposal
    const audioData = new Float32Array(rawAudio.audio);
    const duration = audioData.length / sampleRate;

    // Compute character/syllable-weighted word boundary timings
    const wordTimings = computeWordTimings(text, duration);

    return {
      audio: audioData,
      sampleRate,
      playbackRate: 1.0, // Kokoro already applied speed internally to the waveform
      duration,
      wordTimings
    };
  } catch (err) {
    const errMsg = (err as Error)?.message || String(err);
    // Self-healing fallback: If WebGPU VRAM exhausts or encounters an invalid buffer error mid-generation,
    // immediately recover onto CPU WASM using system RAM without halting playback.
    if (currentDevice === 'webgpu' && (
      errMsg.includes('OUT_OF_DEVICE_MEMORY') ||
      errMsg.includes('Invalid Buffer') ||
      errMsg.includes('WebGPU') ||
      errMsg.includes('device lost')
    )) {
      console.warn('[KokoroTTS] WebGPU memory error encountered. Automatically recovering on WASM q8:', errMsg);
      releaseKokoro();
      await loadKokoro(null, false);
      return await generateKokoro(text, voice, speed);
    }
    throw err;
  } finally {
    // Explicitly dispose all WebGPU tensors (input_ids, style, speed, waveform) to prevent VRAM accumulation
    for (const tensor of activeTensorsToDispose) {
      try {
        tensor.dispose?.();
      } catch {
        // Silently ignore if already disposed
      }
    }
    activeTensorsToDispose = [];
  }
}

/**
 * Heuristic syllable/character-weighted word boundary calculation.
 * Distributes total duration across words proportionally to syllable/vowel weight.
 */
function computeWordTimings(text: string, totalDuration: number): WordTiming[] {
  const words: WordTiming[] = [];
  const regex = /\S+/g;
  let match: RegExpExecArray | null;

  const rawWords: { word: string; charIndex: number; charLength: number; weight: number }[] = [];
  let totalWeight = 0;

  while ((match = regex.exec(text)) !== null) {
    const word = match[0];
    const charIndex = match.index;
    const charLength = word.length;

    // Weight by length + extra weight for vowels/syllables
    const vowels = (word.match(/[aeiouyAEIOUY]/g) || []).length;
    const weight = Math.max(1, word.length * 0.5 + vowels * 0.8);

    rawWords.push({ word, charIndex, charLength, weight });
    totalWeight += weight;
  }

  if (totalWeight === 0) return words;

  let currentSec = 0;
  for (const item of rawWords) {
    const wordDuration = (item.weight / totalWeight) * totalDuration;
    words.push({
      word: item.word,
      charIndex: item.charIndex,
      charLength: item.charLength,
      startTime: currentSec,
      endTime: currentSec + wordDuration
    });
    currentSec += wordDuration;
  }

  return words;
}

/**
 * Release Kokoro resources if needed.
 */
export function releaseKokoro(): void {
  if (kokoroInstance) {
    try {
      const model = (kokoroInstance as unknown as { model?: { dispose?: () => Promise<void> } }).model;
      if (model && typeof model.dispose === 'function') {
        void model.dispose();
      }
    } catch {}
  }
  kokoroInstance = null;
}

export function getKokoroDevice(): 'webgpu' | 'wasm' {
  return currentDevice;
}
