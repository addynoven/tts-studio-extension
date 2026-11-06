/**
 * TTS Engine Router.
 * Delegates to the appropriate model engine based on the requested model.
 * Primary flagship engine is Kokoro-82M (WebGPU), with backwards-compatible support.
 */

import { loadKitten, generateKitten, type TTSResult } from './kitten.js';
import { loadPiper, generatePiper } from './piper.js';
import { loadKokoro, generateKokoro, type KokoroResult } from './kokoro.js';

export type { TTSResult, KokoroResult };

/**
 * Load a model (if not already loaded).
 * @param model - 'kokoro' | 'kitten' | 'piper'
 * @param onProgress - (percent) => void
 * @param useGPU - try WebGPU first
 */
export async function loadModel(
  model: string,
  onProgress?: ((pct: number) => void) | null,
  useGPU = true
): Promise<void> {
  switch (model) {
    case 'kokoro':
      await loadKokoro(onProgress, useGPU);
      break;
    case 'kitten':
      await loadKitten(onProgress, useGPU);
      break;
    case 'piper':
      await loadPiper(onProgress, useGPU);
      break;
    default:
      throw new Error(`Unknown model: ${model}`);
  }
}

/**
 * Generate audio for the given text using the specified model.
 */
export async function generateAudio(
  model: string,
  text: string,
  voice: string,
  speed: number
): Promise<TTSResult> {
  switch (model) {
    case 'kokoro':
      return await generateKokoro(text, voice, speed);
    case 'kitten':
      return await generateKitten(text, voice, speed);
    case 'piper':
      return await generatePiper(text, voice, speed);
    default:
      throw new Error(`Unknown model: ${model}`);
  }
}
