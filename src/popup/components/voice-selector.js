/**
 * Voice dropdown component.
 * Handles voice lists, dynamic Piper loading, and selection persistence.
 */

import { VOICES } from '../../shared/constants.js';

const voiceSelect = document.getElementById('voiceSelect');

let piperVoicesLoaded = false;

/**
 * Load Piper voices dynamically from the model config.
 */
async function loadPiperVoices() {
  if (piperVoicesLoaded) return;
  try {
    const configUrl = chrome.runtime.getURL('models/piper/en_US-libritts_r-medium.onnx.json');
    const res = await fetch(configUrl);
    const config = await res.json();
    const speakers = config.speaker_id_map || {};

    VOICES.piper = Object.entries(speakers)
      .sort(([, a], [, b]) => a - b)
      .map(([id, num]) => ({ id, label: `Speaker ${id}` }));

    piperVoicesLoaded = true;
  } catch (e) {
    console.error('Failed to load Piper voices:', e);
    VOICES.piper = [{ id: '3922', label: 'Speaker 3922 (fallback)' }];
  }
}

/**
 * Populate the voice dropdown for a given model.
 * @param {string} model
 * @param {string} [savedVoice] - Previously saved voice to restore
 */
export async function populateVoices(model, savedVoice) {
  if (model === 'piper') await loadPiperVoices();

  const voices = VOICES[model] || [];
  voiceSelect.innerHTML = voices
    .map(v => `<option value="${v.id}">${v.label}</option>`)
    .join('');

  if (savedVoice && voices.some(v => v.id === savedVoice)) {
    voiceSelect.value = savedVoice;
  }
}

/**
 * Get the currently selected voice.
 * @returns {string}
 */
export function getSelectedVoice() {
  return voiceSelect.value;
}

/**
 * Listen for voice changes.
 * @param {function} callback - (voice) => void
 */
export function onVoiceChange(callback) {
  voiceSelect.addEventListener('change', () => callback(voiceSelect.value));
}
