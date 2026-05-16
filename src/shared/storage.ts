/**
 * Typed storage helpers with schema validation.
 * All persistence goes through here — no direct chrome.storage calls elsewhere.
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
  executionProvider: string;
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
  executionProvider: 'webgpu'
};

// ── Settings ───────────────────────────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings> || {}) };
}

export async function setSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings });
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

export async function addToHistory(entry: { url: string; title: string; lastSentence?: number; totalSentences?: number }): Promise<void> {
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

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ history: [] });
}

// ── Simple key-value ───────────────────────────────────────────────────────

export async function get<T>(key: string, fallback: T | null = null): Promise<T | null> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T) ?? fallback;
}

export async function set<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}
