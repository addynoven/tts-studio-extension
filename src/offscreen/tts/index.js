/**
 * TTS Engine Router.
 * Delegates to the appropriate model engine based on the requested model.
 */

import { loadKitten, generateKitten } from './kitten.js';
import { loadPiper, generatePiper } from './piper.js';

/**
 * Load a model (if not already loaded).
 * @param {string} model - 'kitten' | 'piper'
 * @param {function} onProgress - (percent) => void
 */
export async function loadModel(model, onProgress) {
  switch (model) {
    case 'kitten': await loadKitten(onProgress); break;
    case 'piper':  await loadPiper(onProgress);  break;
    default: throw new Error(`Unknown model: ${model}`);
  }
}

/**
 * Generate audio for the given text using the specified model.
 * @param {string} model
 * @param {string} text
 * @param {string} voice
 * @param {number} speed
 * @returns {Promise<{audio: Float32Array, sampleRate: number}>}
 */
export async function generateAudio(model, text, voice, speed) {
  switch (model) {
    case 'kitten': {
      const audio = await generateKitten(text, voice, speed);
      return { audio, sampleRate: 24000 };
    }
    case 'piper': {
      return await generatePiper(text, voice, speed);
    }
    default:
      throw new Error(`Unknown model: ${model}`);
  }
}
