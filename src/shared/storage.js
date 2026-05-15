/**
 * Typed storage helpers with schema validation.
 * All persistence goes through here — no direct chrome.storage calls elsewhere.
 */

import { DEFAULTS } from './constants.js';

const DEFAULT_SETTINGS = {
  defaultModel: DEFAULTS.model,
  defaultVoice: DEFAULTS.voice,
  defaultSpeed: DEFAULTS.speed,
  sanitization: {
    skipCodeBlocks: true,
    skipUrls: true,
    skipEmojis: true,
    readCodeComments: false,
    stripMarkdown: true
  },
  highlight: {
    color: '#ffeb3b',
    style: 'background',
    opacity: 0.4,
    autoScroll: true
  },
  executionProvider: 'webgpu'
};

// ── Settings ───────────────────────────────────────────────────────────────

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function setSettings(settings) {
  await chrome.storage.local.set({ settings });
}

export async function updateSettings(partial) {
  const current = await getSettings();
  await setSettings({ ...current, ...partial });
}

// ── Playback State (session-scoped) ────────────────────────────────────────

export async function getPlayback() {
  const { playback } = await chrome.storage.session.get('playback');
  return playback || { isPlaying: false, currentSentence: 0, totalSentences: 0, url: null };
}

export async function setPlayback(state) {
  await chrome.storage.session.set({ playback: state });
}

// ── History ────────────────────────────────────────────────────────────────

const MAX_HISTORY = 50;

export async function getHistory() {
  const { history } = await chrome.storage.local.get('history');
  return history || [];
}

export async function addToHistory(entry) {
  const history = await getHistory();
  const filtered = history.filter(h => h.url !== entry.url);
  filtered.unshift({
    url: entry.url,
    title: entry.title,
    domain: new URL(entry.url).hostname,
    date: Date.now(),
    lastSentence: entry.lastSentence || 0,
    totalSentences: entry.totalSentences || 0
  });
  await chrome.storage.local.set({ history: filtered.slice(0, MAX_HISTORY) });
}

export async function clearHistory() {
  await chrome.storage.local.set({ history: [] });
}

// ── Simple key-value ───────────────────────────────────────────────────────

export async function get(key, fallback = null) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? fallback;
}

export async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}
