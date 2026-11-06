/**
 * TTS Engine Router.
 * Dedicated flagship neural engine: Kokoro-82M (WebGPU with WASM fallback).
 * 100% offline, privacy-first, producing 24kHz studio-grade neural speech.
 */

import { loadKokoro, generateKokoro, type KokoroResult, type TTSResult } from './kokoro.js';

export type { TTSResult, KokoroResult };

/**
 * Load Kokoro-82M model.
 * @param _model - Model identifier (defaults to 'kokoro')
 * @param onProgress - (percent) => void
 * @param useGPU - try WebGPU first
 */
export async function loadModel(
  _model = 'kokoro',
  onProgress?: ((pct: number) => void) | null,
  useGPU = true
): Promise<void> {
  await loadKokoro(onProgress, useGPU);
}

/**
 * Generate audio for the given text using Kokoro-82M.
 */
export async function generateAudio(
  _model: string,
  text: string,
  voice: string,
  speed: number
): Promise<TTSResult> {
  return await generateKokoro(text, voice, speed);
}
