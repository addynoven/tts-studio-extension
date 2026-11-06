/**
 * Voice dropdown component.
 * Handles voice lists for Kokoro-82M, Native OS voices, and legacy models.
 */

import { VOICES, MODEL_PATHS } from '../../shared/constants.js';

const voiceSelect = document.getElementById('voiceSelect') as HTMLSelectElement;

let piperVoicesLoaded = false;
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
 * Load Piper voices dynamically from the model config.
 */
async function loadPiperVoices(): Promise<void> {
  if (piperVoicesLoaded) return;
  try {
    const configPath = MODEL_PATHS.piper.config || 'assets/models/piper/en_US-libritts_r-medium.onnx.json';
    const configUrl = chrome.runtime.getURL(configPath);
    const res = await fetch(configUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching Piper config from ${configUrl}`);
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
  if (model === 'native') await loadNativeVoices();
  if (model === 'piper') await loadPiperVoices();

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
