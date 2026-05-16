/**
 * Popup — Entry Point
 * Wires together all popup components.
 */

import { MSG } from '../shared/constants.js';
import { initModelTabs, setActiveModel, getActiveModel } from './components/model-tabs.js';
import { populateVoices, getSelectedVoice, onVoiceChange } from './components/voice-selector.js';
import { initSpeedControl, getSpeed } from './components/speed-control.js';
import { setStatus, updateProgress, initCopyButton, type StatusState } from './components/status-bar.js';
import { createDebugPanel, toggleDebugPanel, addLog } from './components/debug-panel.js';
import { setModuleStatus, setPhase, recordError } from '../shared/state-tracker.js';
import { log } from '../shared/logger.js';
import type { LogEntry } from '../shared/logger.js';

// ── DOM refs ───────────────────────────────────────────────────────────────

const body = document.body;
const textInput = document.getElementById('textInput') as HTMLTextAreaElement;
const charCount = document.getElementById('charCount') as HTMLSpanElement;
const btnGenerate = document.getElementById('btnGenerate') as HTMLButtonElement;
const btnStop = document.getElementById('btnStop') as HTMLButtonElement;
const btnSelected = document.getElementById('btnSelected') as HTMLButtonElement;
const btnDebug = document.getElementById('btnDebug') as HTMLButtonElement;
const gpuToggle = document.getElementById('gpuToggle') as HTMLDivElement;

const btnExtractArticle = document.getElementById('btnExtractArticle') as HTMLButtonElement;
const extractionPanel = document.getElementById('extractionPanel') as HTMLDivElement;
const extractResultText = document.getElementById('extractResultText') as HTMLTextAreaElement;
const extractBlockCount = document.getElementById('extractBlockCount') as HTMLSpanElement;
const btnCloseExtract = document.getElementById('btnCloseExtract') as HTMLButtonElement;
const btnCopyExtract = document.getElementById('btnCopyExtract') as HTMLButtonElement;

// ── State ──────────────────────────────────────────────────────────────────

type UIState = 'idle' | 'loading' | 'playing' | 'paused';

let uiState: UIState = 'idle';
let generationTimeout: ReturnType<typeof setTimeout> | null = null;
const GENERATION_TIMEOUT_MS = 60000; // 60s safety timeout

// ── Init ───────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
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
  const saved = await chrome.storage.local.get(['model', 'voice', 'speed', 'gpu', 'text']) as Record<string, unknown>;

  // Model tabs
  initModelTabs(async (model) => {
    await chrome.storage.local.set({ model });
    await populateVoices(model, saved.voice as string | undefined);
  });

  setActiveModel((saved.model as string) || 'piper');

  // Voices
  await populateVoices(getActiveModel(), saved.voice as string | undefined);
  onVoiceChange(voice => chrome.storage.local.set({ voice }));

  // Speed
  initSpeedControl((saved.speed as number) || 1.0, speed => chrome.storage.local.set({ speed }));

  // GPU toggle
  if (saved.gpu) gpuToggle.classList.toggle('on', saved.gpu as boolean);
  gpuToggle.addEventListener('click', () => {
    gpuToggle.classList.toggle('on');
    chrome.storage.local.set({ gpu: gpuToggle.classList.contains('on') });
  });

  // Text input
  if (saved.text) textInput.value = saved.text as string;
  charCount.textContent = String(textInput.value.length);
  textInput.addEventListener('input', () => {
    charCount.textContent = String(textInput.value.length);
    chrome.storage.local.set({ text: textInput.value });
  });

  // Buttons
  btnGenerate.addEventListener('click', onGenerateClick);
  btnStop.addEventListener('click', stop);
  btnSelected.addEventListener('click', useSelectedText);

  btnExtractArticle.addEventListener('click', extractArticle);

  btnCloseExtract.addEventListener('click', () => {
    extractionPanel.style.display = 'none';
  });

  btnCopyExtract.addEventListener('click', () => {
    extractResultText.select();
    document.execCommand('copy');
    btnCopyExtract.textContent = 'Copied!';
    setTimeout(() => btnCopyExtract.textContent = 'Copy', 2000);
  });

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

async function extractArticle(): Promise<void> {
  setStatus('loading', 'Starting read-aloud stream...');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab');

    // Ensure content script is injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        files: ['content.js']
      });
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.warn('Could not inject content script:', e);
    }

    // Start streaming read-aloud
    await chrome.tabs.sendMessage(tab.id!, { type: MSG.STREAM_START });
    setStatus('playing', 'Reading article aloud...');

  } catch (error) {
    console.error('Stream start failed:', error);
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
  const text = textInput.value.trim();
  if (!text) { setStatus('idle', 'Enter some text first'); return; }
  if (uiState === 'loading' || uiState === 'playing') return;
  if (uiState === 'paused') stop();

  setUIState('loading');
  setStatus('loading', 'Loading model…');
  setPhase('start');

  // Safety timeout — if offscreen hangs/crashes, reset UI
  generationTimeout = setTimeout(() => {
    if (uiState !== 'idle') {
      log('popup', 'warn', 'Generation timed out after ' + GENERATION_TIMEOUT_MS + 'ms');
      setUIState('idle');
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

function pause(): void {
  if (uiState !== 'loading' && uiState !== 'playing') return;
  chrome.runtime.sendMessage({ target: 'offscreen', type: MSG.TTS_PAUSE });
  setUIState('paused');
  setStatus('paused', 'Paused');
}

function resume(): void {
  if (uiState !== 'paused') return;
  chrome.runtime.sendMessage({ target: 'offscreen', type: MSG.TTS_RESUME });
  setUIState('playing');
  setStatus('playing', 'Playing…');
}

function stop(): void {
  chrome.runtime.sendMessage({ target: 'offscreen', type: MSG.TTS_STOP });
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
    const { text } = await chrome.tabs.sendMessage(tab.id, { type: MSG.GET_SELECTION });
    if (text) {
      textInput.value = text;
      charCount.textContent = String(text.length);
      chrome.storage.local.set({ text });
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

  switch (state) {
    case 'idle':
      btnGenerate.innerHTML = '<span>▶</span> Generate';
      btnGenerate.disabled = false;
      btnStop.disabled = true;
      break;
    case 'loading':
      btnGenerate.innerHTML = '<span>⏸</span> Pause';
      btnGenerate.disabled = false;
      btnStop.disabled = false;
      break;
    case 'playing':
      btnGenerate.innerHTML = '<span>⏸</span> Pause';
      btnGenerate.disabled = false;
      btnStop.disabled = false;
      break;
    case 'paused':
      btnGenerate.innerHTML = '<span>▶</span> Resume';
      btnGenerate.disabled = false;
      btnStop.disabled = false;
      break;
  }
}

// ── Message handler ────────────────────────────────────────────────────────

function handleMessages(message: Record<string, unknown>): boolean {
  if (message.target !== 'popup') return false;

  // Debug logs
  if (message.type === 'DEBUG_LOG') {
    addLog(message.entry as LogEntry);
    return false;
  }

  // Status updates from offscreen
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
      setTimeout(() => setStatus('idle', 'Ready'), 3000);
      break;
    case MSG.STATUS_ERROR:
      setUIState('idle');
      setStatus('error', `Error: ${message.error}`);
      recordError('popup', message.error as string);
      setPhase('error', { message: message.error });
      break;
    case MSG.STATUS_PROGRESS:
      updateProgress(message.percent as number);
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
    // No stored logs
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────

init().catch(console.error);
