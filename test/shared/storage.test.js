import { describe, it, expect } from 'vitest';
import {
  getSettings,
  setSettings,
  updateSettings,
  getPlayback,
  setPlayback,
  getHistory,
  addToHistory,
  clearHistory,
  get,
  set
} from '../../src/shared/storage.js';
import { setLocalStored } from '../setup.js';

describe('storage', () => {
  describe('getSettings', () => {
    it('returns defaults when nothing stored', async () => {
      const settings = await getSettings();
      expect(settings.defaultModel).toBe('piper');
      expect(settings.defaultVoice).toBe('3922');
      expect(settings.defaultSpeed).toBe(1.0);
      expect(settings.sanitization.skipCodeBlocks).toBe(true);
      expect(settings.highlight.autoScroll).toBe(true);
    });

    it('merges stored values with defaults', async () => {
      setLocalStored('settings', { defaultModel: 'kitten', defaultSpeed: 1.5 });
      const settings = await getSettings();
      expect(settings.defaultModel).toBe('kitten');
      expect(settings.defaultSpeed).toBe(1.5);
      expect(settings.defaultVoice).toBe('3922'); // default preserved
    });
  });

  describe('setSettings / updateSettings', () => {
    it('stores settings', async () => {
      await setSettings({
        defaultModel: 'kitten',
        defaultVoice: 'Bella',
        defaultSpeed: 1.2,
        sanitization: { skipCodeBlocks: false, skipUrls: true, skipEmojis: true, readCodeComments: false, stripMarkdown: true },
        highlight: { color: '#ffeb3b', style: 'background', opacity: 0.4, autoScroll: true },
        executionProvider: 'cpu'
      });
      const stored = await getSettings();
      expect(stored.defaultModel).toBe('kitten');
    });

    it('updates partial settings', async () => {
      await updateSettings({ defaultSpeed: 0.8 });
      const stored = await getSettings();
      expect(stored.defaultSpeed).toBe(0.8);
      expect(stored.defaultModel).toBe('piper'); // default
    });
  });

  describe('playback', () => {
    it('returns default playback state', async () => {
      const pb = await getPlayback();
      expect(pb.isPlaying).toBe(false);
      expect(pb.currentSentence).toBe(0);
      expect(pb.totalSentences).toBe(0);
      expect(pb.url).toBeNull();
    });

    it('stores and retrieves playback state', async () => {
      await setPlayback({ isPlaying: true, currentSentence: 3, totalSentences: 10, url: 'https://example.com' });
      const pb = await getPlayback();
      expect(pb.isPlaying).toBe(true);
      expect(pb.currentSentence).toBe(3);
      expect(pb.url).toBe('https://example.com');
    });
  });

  describe('history', () => {
    it('returns empty history by default', async () => {
      const history = await getHistory();
      expect(history).toEqual([]);
    });

    it('adds entry to history', async () => {
      await addToHistory({ url: 'https://example.com/article', title: 'Test Article', totalSentences: 5 });
      const history = await getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].url).toBe('https://example.com/article');
      expect(history[0].title).toBe('Test Article');
      expect(history[0].domain).toBe('example.com');
      expect(history[0].totalSentences).toBe(5);
    });

    it('moves duplicate URLs to front', async () => {
      await addToHistory({ url: 'https://a.com', title: 'A' });
      await addToHistory({ url: 'https://b.com', title: 'B' });
      await addToHistory({ url: 'https://a.com', title: 'A Updated' });
      const history = await getHistory();
      expect(history[0].title).toBe('A Updated');
      expect(history).toHaveLength(2);
    });

    it('caps history at 50 entries', async () => {
      for (let i = 0; i < 55; i++) {
        await addToHistory({ url: `https://site${i}.com`, title: `Article ${i}` });
      }
      const history = await getHistory();
      expect(history).toHaveLength(50);
    });

    it('clears history', async () => {
      await addToHistory({ url: 'https://example.com', title: 'Test' });
      await clearHistory();
      const history = await getHistory();
      expect(history).toEqual([]);
    });
  });

  describe('generic get/set', () => {
    it('stores and retrieves a value', async () => {
      await set('myKey', { data: 42 });
      const value = await get('myKey');
      expect(value).toEqual({ data: 42 });
    });

    it('returns fallback for missing key', async () => {
      const value = await get('missing', 'fallback');
      expect(value).toBe('fallback');
    });

    it('returns null for missing key without fallback', async () => {
      const value = await get('missing');
      expect(value).toBeNull();
    });
  });
});
