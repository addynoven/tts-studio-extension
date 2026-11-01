/**
 * Phonemizer wrapper.
 * Loads the espeak-ng WASM phonemizer from the extension's lib folder.
 */

import { getExtensionUrl } from '../../shared/extension-url.js';

const LIB_BASE = getExtensionUrl('assets/lib/');
const PHONEMIZER_URL = LIB_BASE + 'phonemizer.mjs';

interface PhonemizerModule {
  phonemize: (text: string, lang: string) => Promise<string | string[] | { text?: string; phonemes?: string }>;
}

let phonemizerModule: PhonemizerModule | null = null;

/**
 * Load the phonemizer module lazily.
 */
async function loadPhonemizer(): Promise<PhonemizerModule> {
  if (phonemizerModule) return phonemizerModule;
  const mod = await import(/* @vite-ignore */ PHONEMIZER_URL);
  phonemizerModule = mod as PhonemizerModule;
  return phonemizerModule;
}

/**
 * Phonemize text for TTS.
 * @param text - Raw input text
 * @param lang - e.g. 'en-us', 'en'
 * @returns Phoneme string
 */
export async function phonemize(text: string, lang = 'en-us'): Promise<string> {
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
