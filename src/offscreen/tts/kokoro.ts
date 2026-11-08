/**
 * Kokoro-82M Neural Engine (WebGPU / WASM).
 * Runs Kokoro-82M locally in the browser via kokoro-js (ONNX Runtime Web).
 * 100% offline, privacy-first, producing 24kHz studio-grade neural speech.
 */

import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';

export interface TTSResult {
  audio: Float32Array;
  sampleRate: number;
  playbackRate: number;
  duration?: number;
  wordTimings?: WordTiming[];
}

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

/**
 * Intercepts Kokoro's generate_from_ids and underlying model call to capture and immediately
 * dispose all WebGPU input and output tensors (input_ids, style, speed, waveform).
 * This completely prevents WebGPU buffer leakage and Vulkan VK_ERROR_OUT_OF_DEVICE_MEMORY.
 */
function hookKokoroModel(instance: KokoroTTS): void {
  const tts = instance as any;
  if (!tts || tts._isDisposalHooked) return;

  const origGenerateFromIds = tts.generate_from_ids?.bind(tts);
  if (typeof origGenerateFromIds !== 'function') return;

  tts.generate_from_ids = async function (inputIds: any, options: any) {
    const tensorsToDispose: Array<{ dispose?: () => void }> = [];
    if (inputIds && typeof inputIds.dispose === 'function') {
      tensorsToDispose.push(inputIds);
    }

    const origModel = this.model;
    if (typeof origModel === 'function') {
      this.model = async function (modelInputs: any) {
        if (modelInputs && typeof modelInputs === 'object') {
          for (const val of Object.values(modelInputs)) {
            if (val && typeof (val as { dispose?: () => void }).dispose === 'function') {
              tensorsToDispose.push(val as { dispose?: () => void });
            }
          }
        }
        const output = await origModel(modelInputs);
        if (output && typeof output === 'object') {
          for (const val of Object.values(output)) {
            if (val && typeof (val as { dispose?: () => void }).dispose === 'function') {
              tensorsToDispose.push(val as { dispose?: () => void });
            }
          }
        }
        return output;
      };
    }

    try {
      return await origGenerateFromIds(inputIds, options);
    } finally {
      if (typeof origModel === 'function') {
        this.model = origModel;
      }
      for (const tensor of tensorsToDispose) {
        try {
          tensor.dispose?.();
        } catch {
          // Silently ignore if already disposed
        }
      }
    }
  };

  tts._isDisposalHooked = true;
}

/**
 * Detect empty, silent, or corrupted audio output from WebGPU OOM or Dawn validation failures.
 * Returns true if audio is NaN, Infinite, zeroed, or has negligible amplitude throughout.
 */
function isAudioCorruptedOrSilent(audio: Float32Array): boolean {
  if (!audio || audio.length === 0) return true;

  let maxAmp = 0;
  let nonZeroCount = 0;
  const step = Math.max(1, Math.floor(audio.length / 500));

  for (let i = 0; i < audio.length; i += step) {
    const val = audio[i];
    if (!Number.isFinite(val)) {
      return true; // NaN or Infinity
    }
    const abs = Math.abs(val);
    if (abs > maxAmp) maxAmp = abs;
    if (abs > 1e-4) nonZeroCount++;
  }

  // Pure zero or silent buffer check (max amplitude < 1e-5)
  if (maxAmp < 1e-5 || nonZeroCount === 0) {
    return true;
  }

  return false;
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

  try {
    // Pre-sanitize text to ensure no unphonemizable Indic characters trigger eSpeak dictionary errors
    const cleanText = text.replace(/[\u0900-\u0D7F]+/g, ' ').trim();
    if (!cleanText || !(cleanText.match(/[a-zA-Z0-9]/))) {
      return {
        audio: new Float32Array(0),
        sampleRate: 24000,
        playbackRate: 1.0,
        duration: 0,
        wordTimings: []
      };
    }

    const rawAudio = await kokoroInstance.generate(cleanText, {
      voice: voice as unknown as Parameters<typeof kokoroInstance.generate>[1] extends { voice?: infer V } ? V : never,
      speed
    });

    const sampleRate = rawAudio.sampling_rate || 24000;
    // Detach and clone audio data into a new Float32Array in CPU memory
    const audioData = new Float32Array(rawAudio.audio);

    // Sanity check: verify output is not empty/silent/corrupted from an async WebGPU OOM
    if (audioData.length > 0 && isAudioCorruptedOrSilent(audioData)) {
      throw new Error(`Synthesized audio buffer is silent or corrupted (${audioData.length} samples, possible WebGPU VRAM exhaustion)`);
    }

    const duration = audioData.length / sampleRate;

    // Compute character/syllable-weighted word boundary timings
    const wordTimings = computeWordTimings(cleanText, duration);

    return {
      audio: audioData,
      sampleRate,
      playbackRate: 1.0, // Kokoro already applied speed internally to the waveform
      duration,
      wordTimings
    };
  } catch (err) {
    const errMsg = (err as Error)?.message || String(err);
    // Self-healing fallback: If WebGPU VRAM exhausts or encounters corrupted/silent output mid-generation,
    // immediately recover onto CPU WASM using system RAM without halting playback.
    if (currentDevice === 'webgpu' && (
      errMsg.includes('OUT_OF_DEVICE_MEMORY') ||
      errMsg.includes('Invalid Buffer') ||
      errMsg.includes('WebGPU') ||
      errMsg.includes('device lost') ||
      errMsg.includes('silent or corrupted') ||
      errMsg.includes('Vulkan')
    )) {
      console.warn('[KokoroTTS] WebGPU memory error or corrupted output. Automatically recovering on WASM q8:', errMsg);
      releaseKokoro();
      await loadKokoro(null, false);
      return await generateKokoro(text, voice, speed);
    }
    throw err;
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
