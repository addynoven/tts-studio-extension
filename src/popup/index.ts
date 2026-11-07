/**
 * Popup — Entry Point
 * Wires together all popup components with unified storage and UI state.
 */

import { MSG } from '../shared/constants.js';
import { initModelTabs, setActiveModel, getActiveModel } from './components/model-tabs.js';
import { populateVoices, getSelectedVoice, setSelectedVoice, onVoiceChange } from './components/voice-selector.js';
import { initSpeedControl, getSpeed, setSpeed } from './components/speed-control.js';
import { setStatus, updateProgress, initCopyButton } from './components/status-bar.js';
import { createDebugPanel, toggleDebugPanel, addLog } from './components/debug-panel.js';
import { setModuleStatus, setPhase, recordError } from '../shared/state-tracker.js';
import { log } from '../shared/logger.js';
import type { LogEntry } from '../shared/logger.js';
import { getSettings, updateSettings, onSettingsChanged } from '../shared/storage.js';

// ── DOM refs ───────────────────────────────────────────────────────────────

const body = document.body;
const textInput = document.getElementById('textInput') as HTMLTextAreaElement;
const charCount = document.getElementById('charCount') as HTMLSpanElement;
const btnGenerate = document.getElementById('btnGenerate') as HTMLButtonElement;
const btnStop = document.getElementById('btnStop') as HTMLButtonElement;
const btnSelected = document.getElementById('btnSelected') as HTMLButtonElement;
const btnOptions = document.getElementById('btnOptions') as HTMLButtonElement;
const btnDebug = document.getElementById('btnDebug') as HTMLButtonElement;
const gpuToggle = document.getElementById('gpuToggle') as HTMLDivElement;
const btnExtractArticle = document.getElementById('btnExtractArticle') as HTMLButtonElement;

// ── State ──────────────────────────────────────────────────────────────────

type UIState = 'idle' | 'loading' | 'playing' | 'paused';

let uiState: UIState = 'idle';
let generationTimeout: ReturnType<typeof setTimeout> | null = null;
const GENERATION_TIMEOUT_MS = 60000; // 60s safety timeout

// ── Init ───────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  setModuleStatus('popup', 'active');
  createDebugPanel(body);

  // Options page button
  btnOptions?.addEventListener('click', () => {
    if (chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/index.html'));
    }
  });

  // Debug toggle button
  btnDebug?.addEventListener('click', () => {
    const visible = toggleDebugPanel();
    btnDebug.style.opacity = visible ? '1' : '0.5';
  });
  document.addEventListener('debug-panel-closed', () => {
    if (btnDebug) btnDebug.style.opacity = '0.5';
  });

  // Restore saved settings from unified storage
  const settings = await getSettings();

  // Model tabs
  initModelTabs(async (model) => {
    await updateSettings({ defaultModel: model });
    await populateVoices(model, settings.defaultVoice);
  });
  setActiveModel(settings.defaultModel || 'kokoro');

  // Voices
  await populateVoices(getActiveModel(), settings.defaultVoice);
  onVoiceChange(async (voice) => {
    await updateSettings({ defaultVoice: voice });
  });

  // Speed
  initSpeedControl(settings.defaultSpeed || 1.0, async (speed) => {
    await updateSettings({ defaultSpeed: speed });
    chrome.runtime.sendMessage({ target: 'offscreen', type: MSG.TTS_SPEED_CHANGE, speed }).catch(() => {});
  });

  // Listen for real-time external settings changes (e.g. from in-page mini player or options page)
  onSettingsChanged((newSettings) => {
    if (typeof newSettings.defaultSpeed === 'number' && Math.abs(newSettings.defaultSpeed - getSpeed()) > 0.01) {
      setSpeed(newSettings.defaultSpeed);
    }
    if (newSettings.defaultVoice && newSettings.defaultVoice !== getSelectedVoice()) {
      setSelectedVoice(newSettings.defaultVoice);
    }
    if (newSettings.defaultModel && newSettings.defaultModel !== getActiveModel()) {
      setActiveModel(newSettings.defaultModel);
      void populateVoices(newSettings.defaultModel, newSettings.defaultVoice);
    }
  });

  // GPU toggle
  const isGpu = settings.executionProvider === 'webgpu';
  gpuToggle?.classList.toggle('on', isGpu);
  gpuToggle?.addEventListener('click', async () => {
    gpuToggle.classList.toggle('on');
    const enabled = gpuToggle.classList.contains('on');
    await updateSettings({ executionProvider: enabled ? 'webgpu' : 'wasm' });
  });

  // Text input
  if (textInput) {
    if (settings.lastInputText) textInput.value = settings.lastInputText;
    if (charCount) charCount.textContent = String(textInput.value.length);
    textInput.addEventListener('input', () => {
      if (charCount) charCount.textContent = String(textInput.value.length);
      updateSettings({ lastInputText: textInput.value });
    });
  }

  // Action Buttons
  btnGenerate?.addEventListener('click', onGenerateClick);
  btnStop?.addEventListener('click', stop);
  btnSelected?.addEventListener('click', useSelectedText);
  btnExtractArticle?.addEventListener('click', onExtractArticleClick);

  initCopyButton();

  // Active Tab Page Deck detection
  void updatePageDeck();

  // Message listener (offscreen + debug)
  chrome.runtime.onMessage.addListener(handleMessages);

  // Load any stored debug logs
  await loadStoredLogs();

  // Ensure offscreen document exists
  await chrome.runtime.sendMessage({ type: MSG.ENSURE_OFFSCREEN }).catch(() => {});
}

// ── Active Page Deck ───────────────────────────────────────────────────────

async function updatePageDeck(): Promise<void> {
  const deckTitle = document.getElementById('deckTitle');
  const deckDomain = document.getElementById('deckDomain');
  const deckStats = document.getElementById('deckStats');
  if (!deckTitle || !deckDomain) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      deckDomain.textContent = 'Active Tab';
      deckTitle.textContent = 'No web page loaded';
      if (deckStats) deckStats.textContent = 'Ready';
      return;
    }

    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://')) {
      deckDomain.textContent = 'Browser System';
      deckTitle.textContent = tab.title || 'Settings page';
      if (deckStats) deckStats.textContent = 'Offline';
      return;
    }

    try {
      const url = new URL(tab.url);
      deckDomain.textContent = url.hostname.replace(/^www\./, '');
    } catch {
      deckDomain.textContent = 'Web Page';
    }

    deckTitle.textContent = tab.title || 'Web Document';

    // Estimate read time based on title or content
    try {
      const res = await chrome.tabs.sendMessage(tab.id!, { type: MSG.EXTRACT_ARTICLE, previewOnly: true }) as { text?: string; length?: number } | undefined;
      if (res && typeof res.length === 'number' && res.length > 50) {
        const words = Math.round(res.length / 5);
        const mins = Math.max(1, Math.round(words / 180));
        if (deckStats) deckStats.textContent = `~${mins} min read · ${words} words`;
      } else {
        if (deckStats) deckStats.textContent = 'Article detected';
      }
    } catch {
      if (deckStats) deckStats.textContent = 'Web Document';
    }
  } catch {
    deckDomain.textContent = 'Browser Tab';
    deckTitle.textContent = 'Ready to read';
  }
}

// ── Actions ────────────────────────────────────────────────────────────────

function onExtractArticleClick(): void {
  if (uiState === 'idle') {
    extractArticle();
  } else if (uiState === 'loading' || uiState === 'playing') {
    pause();
  } else if (uiState === 'paused') {
    resume();
  }
}

async function extractArticle(): Promise<void> {
  setUIState('loading');
  setStatus('loading', 'Starting read-aloud stream...');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');

    // Ensure content script is injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.warn('Could not inject content script:', e);
    }

    // Start streaming read-aloud
    await chrome.tabs.sendMessage(tab.id, { type: MSG.STREAM_START });
    setUIState('playing');
    setStatus('playing', 'Reading article aloud...');

  } catch (error) {
    console.error('Stream start failed:', error);
    setUIState('idle');
    setStatus('error', 'Failed to start reading');
  }
}

function onGenerateClick(): void {
  if (uiState === 'idle') {
    generate();
  } else if (uiState === 'loading' || uiState === 'playing') {
    pause();
  } else if (uiState === 'paused') {
    resume();
  }
}

async function generate(): Promise<void> {
  const text = textInput ? textInput.value.trim() : '';
  if (!text) { setStatus('idle', 'Enter some text first'); return; }
  if (uiState === 'loading' || uiState === 'playing') return;
  if (uiState === 'paused') stop();

  setUIState('loading');
  setStatus('loading', 'Loading model…');
  setPhase('start');

  generationTimeout = setTimeout(() => {
    if (uiState !== 'idle') {
      log('popup', 'warn', 'Generation timed out after ' + GENERATION_TIMEOUT_MS + 'ms');
      setUIState('idle');
      setStatus('error', 'Timed out — model may be stuck. Try again.');
      setPhase('error', { message: 'Generation timeout' });
    }
  }, GENERATION_TIMEOUT_MS);

  chrome.runtime.sendMessage({
    type: MSG.TTS_GENERATE,
    text,
    model: getActiveModel(),
    voice: getSelectedVoice(),
    speed: getSpeed(),
    useGPU: gpuToggle ? gpuToggle.classList.contains('on') : true
  }).catch((e: Error) => {
    setUIState('idle');
    setStatus('error', e.message);
  });
}

function pause(): void {
  if (uiState !== 'loading' && uiState !== 'playing') return;
  chrome.runtime.sendMessage({ type: MSG.TTS_TOGGLE_PLAYBACK }).catch(() => {});
  chrome.runtime.sendMessage({ target: 'offscreen', type: MSG.TTS_TOGGLE_PLAYBACK }).catch(() => {});
  setUIState('paused');
  setStatus('paused', 'Paused');
}

function resume(): void {
  if (uiState !== 'paused') return;
  chrome.runtime.sendMessage({ type: MSG.TTS_TOGGLE_PLAYBACK }).catch(() => {});
  chrome.runtime.sendMessage({ target: 'offscreen', type: MSG.TTS_TOGGLE_PLAYBACK }).catch(() => {});
  setUIState('playing');
  setStatus('playing', 'Playing…');
}

function stop(): void {
  chrome.runtime.sendMessage({ type: MSG.TTS_STOP }).catch(() => {});
  chrome.runtime.sendMessage({ target: 'offscreen', type: MSG.TTS_STOP }).catch(() => {});
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: MSG.CLEAR_HIGHLIGHTS }).catch(() => {});
      chrome.tabs.sendMessage(tab.id, { type: MSG.TTS_STOP }).catch(() => {});
    }
  });
  setUIState('idle');
  setStatus('idle', 'Stopped');
}

function clearGenerationTimeout(): void {
  if (generationTimeout) {
    clearTimeout(generationTimeout);
    generationTimeout = null;
  }
}

async function useSelectedText(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: MSG.GET_SELECTION }) as { text?: string } | undefined;
    if (res?.text) {
      if (textInput) {
        textInput.value = res.text;
        if (charCount) charCount.textContent = String(res.text.length);
        await updateSettings({ lastInputText: res.text });
      }
      generate();
    } else {
      setStatus('idle', 'No text selected on page');
    }
  } catch {
    setStatus('error', 'Cannot read page — try reloading it');
  }
}

// ── UI State machine ───────────────────────────────────────────────────────

function setUIState(state: UIState): void {
  uiState = state;
  clearGenerationTimeout();

  const playIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
  const pauseIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;

  switch (state) {
    case 'idle':
      if (btnExtractArticle) {
        btnExtractArticle.innerHTML = `${playIcon} <span>Read Article</span>`;
        btnExtractArticle.disabled = false;
      }
      if (btnGenerate) {
        btnGenerate.innerHTML = `${playIcon} <span>Synthesize Text</span>`;
        btnGenerate.disabled = false;
      }
      if (btnStop) btnStop.disabled = true;
      break;
    case 'loading':
      if (btnExtractArticle) {
        btnExtractArticle.innerHTML = `${pauseIcon} <span>Pause</span>`;
        btnExtractArticle.disabled = false;
      }
      if (btnGenerate) {
        btnGenerate.innerHTML = `${pauseIcon} <span>Pause</span>`;
        btnGenerate.disabled = false;
      }
      if (btnStop) btnStop.disabled = false;
      break;
    case 'playing':
      if (btnExtractArticle) {
        btnExtractArticle.innerHTML = `${pauseIcon} <span>Pause</span>`;
        btnExtractArticle.disabled = false;
      }
      if (btnGenerate) {
        btnGenerate.innerHTML = `${pauseIcon} <span>Pause</span>`;
        btnGenerate.disabled = false;
      }
      if (btnStop) btnStop.disabled = false;
      break;
    case 'paused':
      if (btnExtractArticle) {
        btnExtractArticle.innerHTML = `${playIcon} <span>Resume</span>`;
        btnExtractArticle.disabled = false;
      }
      if (btnGenerate) {
        btnGenerate.innerHTML = `${playIcon} <span>Resume</span>`;
        btnGenerate.disabled = false;
      }
      if (btnStop) btnStop.disabled = false;
      break;
  }
}

// ── Message handler ────────────────────────────────────────────────────────

function handleMessages(message: Record<string, unknown>): boolean {
  if (message.target !== 'popup') return false;

  if (message.type === 'DEBUG_LOG') {
    addLog(message.entry as LogEntry);
    return false;
  }

  switch (message.type) {
    case MSG.STATUS_MODEL_LOADING:
      setStatus('loading', `Downloading ${message.model} model… first time only`);
      break;
    case MSG.STATUS_GENERATING:
      setUIState('loading');
      setStatus('generating', 'Synthesizing speech…');
      break;
    case MSG.STATUS_PLAYING:
      setUIState('playing');
      setStatus('playing', 'Playing…');
      break;
    case MSG.STATUS_PAUSED:
      setUIState('paused');
      setStatus('paused', 'Paused');
      break;
    case MSG.STATUS_DONE:
      setUIState('idle');
      setStatus('ready', 'Done ✓');
      setPhase('done');
      setTimeout(() => {
        if (uiState === 'idle') setStatus('idle', 'Ready');
      }, 3000);
      break;
    case MSG.STATUS_ERROR:
      setUIState('idle');
      setStatus('error', `Error: ${message.error}`);
      recordError('popup', String(message.error || 'Unknown error'));
      setPhase('error', { message: String(message.error || 'Unknown error') });
      break;
    case MSG.STATUS_PROGRESS:
      updateProgress(Number(message.percent || 0));
      break;
  }
  return false;
}

// ── Load stored logs ───────────────────────────────────────────────────────

async function loadStoredLogs(): Promise<void> {
  try {
    const { tts_debug_logs: logs } = await chrome.storage.session.get('tts_debug_logs');
    if (logs && Array.isArray(logs)) {
      logs.forEach((entry: LogEntry) => addLog(entry));
    }
  } catch {
    // Session logs unavailable
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────

init().catch(console.error);
