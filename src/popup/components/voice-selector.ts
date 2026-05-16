/**
 * Voice dropdown component.
 * Handles voice lists, dynamic Piper loading, and selection persistence.
 */

import { VOICES } from '../../shared/constants.js';

const voiceSelect = document.getElementById('voiceSelect') as HTMLSelectElement;

let piperVoicesLoaded = false;

/**
 * Load Piper voices dynamically from the model config.
 */
async function loadPiperVoices(): Promise<void> {
  if (piperVoicesLoaded) return;
  try {
    const configUrl = chrome.runtime.getURL('models/piper/en_US-libritts_r-medium.onnx.json');
    const res = await fetch(configUrl);
    const config = await res.json() as { speaker_id_map?: Record<string, number> };
    const speakers = config.speaker_id_map || {};

    (VOICES as Record<string, Array<{ id: string; label: string }>>).piper = Object.entries(speakers)
      .sort(([, a], [, b]) => (a as number) - (b as number))
      .map(([id]) => ({ id, label: `Speaker ${id}` }));

    piperVoicesLoaded = true;
  } catch (e) {
    console.error('Failed to load Piper voices:', e);
    (VOICES as Record<string, Array<{ id: string; label: string }>>).piper = [{ id: '3922', label: 'Speaker 3922 (fallback)' }];
  }
}

/**
 * Populate the voice dropdown for a given model.
 */
export async function populateVoices(model: string, savedVoice?: string): Promise<void> {
  if (model === 'piper') await loadPiperVoices();

  const voices = (VOICES as Record<string, Array<{ id: string; label: string }>>)[model] || [];
  voiceSelect.innerHTML = voices
    .map(v => `<option value="${v.id}">${v.label}</option>`)
    .join('');

  if (savedVoice && voices.some(v => v.id === savedVoice)) {
    voiceSelect.value = savedVoice;
  }
}

/**
 * Get the currently selected voice.
 */
export function getSelectedVoice(): string {
  return voiceSelect.value;
}

/**
 * Listen for voice changes.
 */
export function onVoiceChange(callback: (voice: string) => void): void {
  voiceSelect.addEventListener('change', () => callback(voiceSelect.value));
}
