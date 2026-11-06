/**
 * Options Workstation — Engine & Reading Configuration.
 * Fully type-safe two-way binding with unified chrome.storage.
 */

import { VOICES } from '../shared/constants.js';
import { getSettings, updateSettings } from '../shared/storage.js';

// DOM Elements
const defaultModelSelect = document.getElementById('defaultModelSelect') as HTMLSelectElement;
const defaultVoiceSelect = document.getElementById('defaultVoiceSelect') as HTMLSelectElement;
const speedSlider = document.getElementById('speedSlider') as HTMLInputElement;
const speedVal = document.getElementById('speedVal') as HTMLSpanElement;
const gpuToggle = document.getElementById('gpuToggle') as HTMLInputElement;

const skipCodeBlocks = document.getElementById('skipCodeBlocks') as HTMLInputElement;
const skipUrls = document.getElementById('skipUrls') as HTMLInputElement;
const skipEmojis = document.getElementById('skipEmojis') as HTMLInputElement;
const stripMarkdown = document.getElementById('stripMarkdown') as HTMLInputElement;

const autoScroll = document.getElementById('autoScroll') as HTMLInputElement;
const highlightColor = document.getElementById('highlightColor') as HTMLSelectElement;

const storageStatusText = document.getElementById('storageStatusText') as HTMLSpanElement;
const btnRequestPersist = document.getElementById('btnRequestPersist') as HTMLButtonElement;
const btnClearCache = document.getElementById('btnClearCache') as HTMLButtonElement;
const toast = document.getElementById('toast') as HTMLDivElement;

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message = 'Settings saved'): void {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

function populateVoiceOptions(selectedVoice?: string): void {
  if (!defaultVoiceSelect) return;
  const kokoroVoices = VOICES.kokoro || [];

  defaultVoiceSelect.innerHTML = kokoroVoices
    .map(v => `<option value="${v.id}">${v.label}</option>`)
    .join('');

  if (selectedVoice && kokoroVoices.some(v => v.id === selectedVoice)) {
    defaultVoiceSelect.value = selectedVoice;
  }
}

async function checkStoragePersistence(): Promise<void> {
  if (!navigator.storage || !navigator.storage.persisted) {
    if (storageStatusText) storageStatusText.textContent = 'Storage API unavailable in this browser.';
    if (btnRequestPersist) btnRequestPersist.disabled = true;
    return;
  }

  const isPersisted = await navigator.storage.persisted();
  if (isPersisted) {
    if (storageStatusText) storageStatusText.textContent = 'Active: Chrome will never evict cached neural models.';
    if (btnRequestPersist) {
      btnRequestPersist.textContent = 'Protected ✓';
      btnRequestPersist.disabled = true;
    }
  } else {
    if (storageStatusText) storageStatusText.textContent = 'Standard: Storage may be cleared if disk space is low.';
    if (btnRequestPersist) {
      btnRequestPersist.textContent = 'Enable Protection';
      btnRequestPersist.disabled = false;
    }
  }
}

async function init(): Promise<void> {
  const settings = await getSettings();

  // Populate Voices
  populateVoiceOptions(settings.defaultVoice);

  // Set Engine & GPU
  defaultModelSelect.value = settings.defaultModel || 'kokoro';
  gpuToggle.checked = settings.executionProvider === 'webgpu';

  // Set Speed
  speedSlider.value = String(settings.defaultSpeed || 1.0);
  speedVal.textContent = `${Number(speedSlider.value).toFixed(2)}×`;

  // Set Sanitization
  skipCodeBlocks.checked = settings.sanitization.skipCodeBlocks;
  skipUrls.checked = settings.sanitization.skipUrls;
  skipEmojis.checked = settings.sanitization.skipEmojis;
  stripMarkdown.checked = settings.sanitization.stripMarkdown;

  // Set Highlighting
  autoScroll.checked = settings.highlight.autoScroll;
  highlightColor.value = settings.highlight.color || '#ffeb3b';

  // Check Storage
  await checkStoragePersistence();

  // Event Listeners - Engine
  defaultModelSelect.addEventListener('change', async () => {
    await updateSettings({ defaultModel: defaultModelSelect.value });
    showToast();
  });

  gpuToggle.addEventListener('change', async () => {
    await updateSettings({ executionProvider: gpuToggle.checked ? 'webgpu' : 'wasm' });
    showToast();
  });

  // Event Listeners - Voice & Speed
  defaultVoiceSelect.addEventListener('change', async () => {
    await updateSettings({ defaultVoice: defaultVoiceSelect.value });
    showToast();
  });

  speedSlider.addEventListener('input', async () => {
    const val = Number(speedSlider.value);
    speedVal.textContent = `${val.toFixed(2)}×`;
    await updateSettings({ defaultSpeed: val });
    showToast();
  });

  // Event Listeners - Sanitization
  const onSanitizationChange = async () => {
    await updateSettings({
      sanitization: {
        skipCodeBlocks: skipCodeBlocks.checked,
        skipUrls: skipUrls.checked,
        skipEmojis: skipEmojis.checked,
        readCodeComments: settings.sanitization.readCodeComments,
        stripMarkdown: stripMarkdown.checked
      }
    });
    showToast();
  };

  skipCodeBlocks.addEventListener('change', onSanitizationChange);
  skipUrls.addEventListener('change', onSanitizationChange);
  skipEmojis.addEventListener('change', onSanitizationChange);
  stripMarkdown.addEventListener('change', onSanitizationChange);

  // Event Listeners - Highlighting
  autoScroll.addEventListener('change', async () => {
    await updateSettings({
      highlight: {
        ...settings.highlight,
        autoScroll: autoScroll.checked
      }
    });
    showToast();
  });

  highlightColor.addEventListener('change', async () => {
    await updateSettings({
      highlight: {
        ...settings.highlight,
        color: highlightColor.value
      }
    });
    showToast();
  });

  // Persistent Storage Request
  btnRequestPersist.addEventListener('click', async () => {
    if (navigator.storage && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      if (granted) {
        showToast('Storage persistence granted');
      }
      await checkStoragePersistence();
    }
  });

  // Clear Cache
  btnClearCache.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear cached neural models? They will re-download upon next synthesis.')) {
      return;
    }
    try {
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        for (const k of keys) {
          await caches.delete(k);
        }
      }
      showToast('Cache cleared successfully');
    } catch (e) {
      showToast('Failed to clear cache: ' + (e as Error).message);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  void init();
});
