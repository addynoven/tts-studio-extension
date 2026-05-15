/**
 * Phonemizer wrapper.
 * Loads the espeak-ng WASM phonemizer from the extension's lib folder.
 */

import { LIB_PATHS } from '../../shared/constants.js';

const LIB_BASE = chrome.runtime.getURL('assets/lib/');
const PHONEMIZER_URL = LIB_BASE + 'phonemizer.mjs';

let phonemizerModule = null;

/**
 * Load the phonemizer module lazily.
 */
async function loadPhonemizer() {
  if (phonemizerModule) return phonemizerModule;
  phonemizerModule = await import(PHONEMIZER_URL);
  return phonemizerModule;
}

/**
 * Phonemize text for TTS.
 * @param {string} text
 * @param {string} lang - e.g. 'en-us', 'en'
 * @returns {Promise<string>} Phoneme string
 */
export async function phonemize(text, lang = 'en-us') {
  const { phonemize: phonemizeFn } = await loadPhonemizer();
  const result = await phonemizeFn(text, lang);

  // Normalize return type (string, array, or object)
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) return result.join(' ');
  if (result && typeof result === 'object') {
    return result.text || result.phonemes || String(result);
  }
  return String(result || text);
}


