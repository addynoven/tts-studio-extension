/**
 * Kokoro-82M Neural Engine (WebGPU / WASM).
 * Runs Kokoro-82M locally in the browser via kokoro-js (ONNX Runtime Web).
 * 100% offline, privacy-first, producing 24kHz studio-grade neural speech.
 */

import { KokoroTTS } from 'kokoro-js';
import type { TTSResult } from './kitten.js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let kokoroInstance: KokoroTTS | null = null;
let currentDevice: 'webgpu' | 'wasm' = 'webgpu';

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
 * Tries WebGPU first for maximum speed, falling back to WASM if unsupported.
 */
export async function loadKokoro(
  onProgress?: ((pct: number) => void) | null,
  useGPU = true
): Promise<void> {
  if (kokoroInstance) return;

  const targetDevice = useGPU ? 'webgpu' : 'wasm';

  try {
    kokoroInstance = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: 'q8',
      device: targetDevice,
      progress_callback: (progress: { status: string; progress?: number }) => {
        if (onProgress && typeof progress.progress === 'number') {
          onProgress(Math.round(progress.progress * 100));
        }
      }
    });
    currentDevice = targetDevice;
  } catch (err) {
    if (useGPU) {
      console.warn('[KokoroTTS] WebGPU failed, falling back to WASM:', err);
      kokoroInstance = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (progress: { status: string; progress?: number }) => {
          if (onProgress && typeof progress.progress === 'number') {
            onProgress(Math.round(progress.progress * 100));
          }
        }
      });
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

  const rawAudio = await kokoroInstance.generate(text, {
    voice: voice as unknown as Parameters<typeof kokoroInstance.generate>[1] extends { voice?: infer V } ? V : never,
    speed
  });

  const sampleRate = rawAudio.sampling_rate || 24000;
  const audioData = rawAudio.audio;
  const duration = audioData.length / sampleRate;

  // Compute character/syllable-weighted word boundary timings
  const wordTimings = computeWordTimings(text, duration);

  return {
    audio: audioData,
    sampleRate,
    playbackRate: speed,
    duration,
    wordTimings
  };
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
  kokoroInstance = null;
}

export function getKokoroDevice(): 'webgpu' | 'wasm' {
  return currentDevice;
}
