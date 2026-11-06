/**
 * Voice dropdown component.
 * Handles voice lists for Kokoro-82M and Native OS voices.
 */

import { VOICES } from '../../shared/constants.js';

const voiceSelect = document.getElementById('voiceSelect') as HTMLSelectElement;

let nativeVoicesLoaded = false;

/**
 * Load Native OS voices from chrome.tts.
 */
async function loadNativeVoices(): Promise<void> {
  if (nativeVoicesLoaded) return;
  if (typeof chrome === 'undefined' || !chrome.tts?.getVoices) return;

  return new Promise((resolve) => {
    chrome.tts.getVoices((voices) => {
      const list = (voices || []).map((v) => ({
        id: v.voiceName || 'default',
        label: `${v.voiceName || 'System Default'} (${v.lang || 'system'})`
      }));

      (VOICES as Record<string, Array<{ id: string; label: string }>>).native = list.length > 0
        ? list
        : [{ id: 'default', label: 'System Default' }];

      nativeVoicesLoaded = true;
      resolve();
    });
  });
}

/**
 * Populate the voice dropdown for a given model.
 */
export async function populateVoices(model: string, savedVoice?: string): Promise<void> {
  if (model === 'native') await loadNativeVoices();

  const voices = (VOICES as Record<string, Array<{ id: string; label: string }>>)[model] || [];
  if (voiceSelect) {
    voiceSelect.innerHTML = voices
      .map(v => `<option value="${v.id}">${v.label}</option>`)
      .join('');

    if (savedVoice && voices.some(v => v.id === savedVoice)) {
      voiceSelect.value = savedVoice;
    }
  }
}

/**
 * Get the currently selected voice.
 */
export function getSelectedVoice(): string {
  return voiceSelect ? voiceSelect.value : '';
}

/**
 * Listen for voice changes.
 */
export function onVoiceChange(callback: (voice: string) => void): void {
  voiceSelect?.addEventListener('change', () => callback(voiceSelect.value));
}
