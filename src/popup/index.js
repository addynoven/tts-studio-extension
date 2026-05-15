/**
 * Popup — Entry Point
 * Wires together all popup components.
 */

import { MSG } from '../shared/constants.js';
import { initModelTabs, setActiveModel, getActiveModel } from './components/model-tabs.js';
import { populateVoices, getSelectedVoice, onVoiceChange } from './components/voice-selector.js';
import { initSpeedControl, getSpeed } from './components/speed-control.js';
import { setStatus, updateProgress, initCopyButton } from './components/status-bar.js';
import { createDebugPanel, toggleDebugPanel, addLog } from './components/debug-panel.js';
import { setModuleStatus, setPhase, recordError } from '../shared/state-tracker.js';

// ── DOM refs ───────────────────────────────────────────────────────────────

const body = document.body;
const textInput = document.getElementById('textInput');
const charCount = document.getElementById('charCount');
const btnGenerate = document.getElementById('btnGenerate');
const btnStop = document.getElementById('btnStop');
const btnSelected = document.getElementById('btnSelected');
const btnDebug = document.getElementById('btnDebug');
const gpuToggle = document.getElementById('gpuToggle');

// ── State ──────────────────────────────────────────────────────────────────

let isGenerating = false;
let generationTimeout = null;
const GENERATION_TIMEOUT_MS = 60000; // 60s safety timeout

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  setModuleStatus('popup', 'active');
  // Create debug panel (hidden by default)
  createDebugPanel(body);

  // Debug toggle button
  btnDebug.addEventListener('click', () => {
    const visible = toggleDebugPanel();
    btnDebug.style.opacity = visible ? '1' : '0.5';
  });
  document.addEventListener('debug-panel-closed', () => {
    btnDebug.style.opacity = '0.5';
  });

  // Restore saved settings
  const saved = await chrome.storage.local.get(['model', 'voice', 'speed', 'gpu', 'text']);

  // Model tabs
  initModelTabs(async (model) => {
    await chrome.storage.local.set({ model });
    await populateVoices(model, saved.voice);
  });

  if (saved.model) {
    setActiveModel(saved.model);
  }

  // Voices
  await populateVoices(getActiveModel(), saved.voice);
  onVoiceChange(voice => chrome.storage.local.set({ voice }));

  // Speed
  initSpeedControl(saved.speed || 1.0, speed => chrome.storage.local.set({ speed }));

  // GPU toggle
  if (saved.gpu) gpuToggle.classList.toggle('on', saved.gpu);
  gpuToggle.addEventListener('click', () => {
    gpuToggle.classList.toggle('on');
    chrome.storage.local.set({ gpu: gpuToggle.classList.contains('on') });
  });

  // Text input
  if (saved.text) textInput.value = saved.text;
  charCount.textContent = textInput.value.length;
  textInput.addEventListener('input', () => {
    charCount.textContent = textInput.value.length;
    chrome.storage.local.set({ text: textInput.value });
  });

  // Buttons
  btnGenerate.addEventListener('click', generate);
  btnStop.addEventListener('click', stop);
  btnSelected.addEventListener('click', useSelectedText);

  // Copy button
  initCopyButton();

  // Message listener (offscreen + debug)
  chrome.runtime.onMessage.addListener(handleMessages);

  // Load any stored debug logs
  loadStoredLogs();

  // Ensure offscreen document exists
  await chrome.runtime.sendMessage({ type: MSG.ENSURE_OFFSCREEN });
}

// ─- Actions ────────────────────────────────────────────────────────────────

async function generate() {
  const text = textInput.value.trim();
  if (!text) { setStatus('idle', 'Enter some text first'); return; }
  if (isGenerating) return;

  isGenerating = true;
  btnGenerate.disabled = true;
  btnStop.disabled = false;
  setStatus('loading', 'Loading model…');
  setPhase('start');

  // Safety timeout — if offscreen hangs/crashes, reset UI
  generationTimeout = setTimeout(() => {
    if (isGenerating) {
      log('popup', 'warn', 'Generation timed out after ' + GENERATION_TIMEOUT_MS + 'ms');
      resetButtons();
      setStatus('error', 'Timed out — model may be stuck. Try again.');
      setPhase('error', { message: 'Generation timeout' });
    }
  }, GENERATION_TIMEOUT_MS);

  chrome.runtime.sendMessage({
    target: 'offscreen',
    type: MSG.TTS_GENERATE,
    text,
    model: getActiveModel(),
    voice: getSelectedVoice(),
    speed: getSpeed(),
    useGPU: gpuToggle.classList.contains('on')
  });
}

function stop() {
  chrome.runtime.sendMessage({ target: 'offscreen', type: MSG.TTS_STOP });
  resetButtons();
  setStatus('idle', 'Stopped');
}

function clearGenerationTimeout() {
  if (generationTimeout) {
    clearTimeout(generationTimeout);
    generationTimeout = null;
  }
}

async function useSelectedText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    const { text } = await chrome.tabs.sendMessage(tab.id, { type: MSG.GET_SELECTION });
    if (text) {
      textInput.value = text;
      charCount.textContent = text.length;
      chrome.storage.local.set({ text });
    } else {
      setStatus('idle', 'No text selected on page');
    }
  } catch {
    setStatus('error', 'Cannot read page — try reloading it');
  }
}

function resetButtons() {
  isGenerating = false;
  btnGenerate.disabled = false;
  btnStop.disabled = true;
  clearGenerationTimeout();
}

// ── Message handler ────────────────────────────────────────────────────────

function handleMessages(message) {
  if (message.target !== 'popup') return;

  // Debug logs
  if (message.type === 'DEBUG_LOG') {
    addLog(message.entry);
    return;
  }

  // Status updates from offscreen
  switch (message.type) {
    case MSG.STATUS_MODEL_LOADING:
      setStatus('loading', `Downloading ${message.model} model… first time only`);
      break;
    case MSG.STATUS_GENERATING:
      setStatus('generating', 'Synthesizing speech…');
      break;
    case MSG.STATUS_PLAYING:
      setStatus('playing', 'Playing…');
      break;
    case MSG.STATUS_DONE:
      resetButtons();
      setStatus('ready', 'Done ✓');
      setPhase('done');
      setTimeout(() => setStatus('idle', 'Ready'), 3000);
      break;
    case MSG.STATUS_ERROR:
      resetButtons();
      setStatus('error', `Error: ${message.error}`);
      recordError('popup', message.error);
      setPhase('error', { message: message.error });
      break;
    case MSG.STATUS_PROGRESS:
      updateProgress(message.percent);
      break;
  }
}

// ── Load stored logs ───────────────────────────────────────────────────────

async function loadStoredLogs() {
  try {
    const { tts_debug_logs: logs } = await chrome.storage.session.get('tts_debug_logs');
    if (logs && Array.isArray(logs)) {
      logs.forEach(entry => addLog(entry));
    }
  } catch {
    // No stored logs
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────

init().catch(console.error);
