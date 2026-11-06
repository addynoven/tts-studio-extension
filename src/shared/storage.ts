/**
 * Typed storage helpers with schema validation.
 * All persistence goes through here — single source of truth.
 */

import { DEFAULTS } from './constants.js';

export interface SanitizationSettings {
  skipCodeBlocks: boolean;
  skipUrls: boolean;
  skipEmojis: boolean;
  readCodeComments: boolean;
  stripMarkdown: boolean;
}

export interface HighlightSettings {
  color: string;
  style: string;
  opacity: number;
  autoScroll: boolean;
}

export interface Settings {
  defaultModel: string;
  defaultVoice: string;
  defaultSpeed: number;
  sanitization: SanitizationSettings;
  highlight: HighlightSettings;
  executionProvider: 'webgpu' | 'wasm';
  lastInputText?: string;
}

export interface Playback {
  isPlaying: boolean;
  currentSentence: number;
  totalSentences: number;
  url: string | null;
}

export interface HistoryEntry {
  url: string;
  title: string;
  domain: string;
  date: number;
  lastSentence: number;
  totalSentences: number;
}

const DEFAULT_SETTINGS: Settings = {
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
  executionProvider: 'webgpu',
  lastInputText: ''
};

// ── Settings ───────────────────────────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return DEFAULT_SETTINGS;
  }
  try {
    const result = await chrome.storage.local.get(['settings', 'model', 'voice', 'speed', 'gpu', 'text']);
    const storedSettings = (result.settings as Partial<Settings> | undefined) || {};

    // Compatibility fallback for legacy top-level keys if settings wasn't saved yet
    const defaultModel = storedSettings.defaultModel || (typeof result.model === 'string' ? result.model : DEFAULT_SETTINGS.defaultModel);
    const defaultVoice = storedSettings.defaultVoice || (typeof result.voice === 'string' ? result.voice : DEFAULT_SETTINGS.defaultVoice);
    const defaultSpeed = storedSettings.defaultSpeed ?? (typeof result.speed === 'number' ? result.speed : DEFAULT_SETTINGS.defaultSpeed);
    const executionProvider = storedSettings.executionProvider || (result.gpu === false ? 'wasm' : 'webgpu');
    const lastInputText = storedSettings.lastInputText ?? (typeof result.text === 'string' ? result.text : '');

    return {
      ...DEFAULT_SETTINGS,
      ...storedSettings,
      defaultModel,
      defaultVoice,
      defaultSpeed,
      executionProvider,
      lastInputText
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function setSettings(settings: Settings): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  try {
    await chrome.storage.local.set({
      settings,
      // Keep top-level keys in sync for backward compatibility
      model: settings.defaultModel,
      voice: settings.defaultVoice,
      speed: settings.defaultSpeed,
      gpu: settings.executionProvider === 'webgpu',
      text: settings.lastInputText
    });
  } catch {
    // Gracefully ignore storage write failures if context invalidated
  }
}

export async function updateSettings(partial: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await setSettings({ ...current, ...partial });
}

// ── Playback State (session-scoped) ────────────────────────────────────────

export async function getPlayback(): Promise<Playback> {
  const { playback } = await chrome.storage.session.get('playback');
  return (playback as Playback | undefined) || { isPlaying: false, currentSentence: 0, totalSentences: 0, url: null };
}

export async function setPlayback(state: Playback): Promise<void> {
  await chrome.storage.session.set({ playback: state });
}

// ── History ────────────────────────────────────────────────────────────────

const MAX_HISTORY = 50;

export async function getHistory(): Promise<HistoryEntry[]> {
  const { history } = await chrome.storage.local.get('history');
  return (history as HistoryEntry[] | undefined) || [];
}

export async function addToHistory(entry: Omit<HistoryEntry, 'date' | 'domain'>): Promise<void> {
  const history = await getHistory();
  const domain = new URL(entry.url).hostname;
  const newEntry: HistoryEntry = {
    ...entry,
    domain,
    date: Date.now()
  };

  const filtered = history.filter(h => h.url !== entry.url);
  const updated = [newEntry, ...filtered].slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ history: updated });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove('history');
}

// ── Generic Key-Value Helpers ──────────────────────────────────────────────

export async function get<T>(key: string, fallback: T | null = null): Promise<T | null> {
  const result = await chrome.storage.local.get(key);
  return result[key] !== undefined ? (result[key] as T) : fallback;
}

export async function set<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

