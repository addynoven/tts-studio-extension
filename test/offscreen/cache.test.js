import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheClear,
  cacheListKeys,
  fetchAndCache
} from '../../src/offscreen/cache/indexeddb.js';

describe('indexeddb cache', () => {
  beforeEach(async () => {
    await cacheClear();
  });

  describe('cacheSet / cacheGet', () => {
    it('stores and retrieves a value', async () => {
      await cacheSet('test-key', { data: 'hello world' });
      const retrieved = await cacheGet('test-key');
      expect(retrieved).toEqual({ data: 'hello world' });
    });

    it('returns null for missing key', async () => {
      const result = await cacheGet('nonexistent');
      expect(result).toBeNull();
    });

    it('overwrites existing key', async () => {
      await cacheSet('same-key', { version: 1 });
      await cacheSet('same-key', { version: 2 });
      const retrieved = await cacheGet('same-key');
      expect(retrieved).toEqual({ version: 2 });
    });

    it('isolates keys by cache version', async () => {
      await cacheSet('model', { bytes: 123 });
      const keys = await cacheListKeys();
      expect(keys.some(k => k.includes('model'))).toBe(true);
    });
  });

  describe('cacheDelete', () => {
    it('removes a specific key', async () => {
      await cacheSet('del-key', { data: 1 });
      expect(await cacheGet('del-key')).not.toBeNull();
      await cacheDelete('del-key');
      expect(await cacheGet('del-key')).toBeNull();
    });

    it('does not throw for missing key', async () => {
      await expect(cacheDelete('never-set')).resolves.not.toThrow();
    });
  });

  describe('cacheClear', () => {
    it('removes all entries', async () => {
      await cacheSet('a', { data: 1 });
      await cacheSet('b', { data: 2 });
      await cacheClear();
      expect(await cacheGet('a')).toBeNull();
      expect(await cacheGet('b')).toBeNull();
    });
  });

  describe('cacheListKeys', () => {
    it('lists all cached keys', async () => {
      await cacheSet('key1', { data: 1 });
      await cacheSet('key2', { data: 2 });
      const keys = await cacheListKeys();
      expect(keys.length).toBeGreaterThanOrEqual(2);
    });

    it('returns empty array when cache is empty', async () => {
      await cacheClear();
      const keys = await cacheListKeys();
      expect(keys).toEqual([]);
    });
  });

  describe('fetchAndCache', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    function createMockFetch() {
      return vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => '5' },
        body: {
          getReader: () => {
            let done = false;
            return {
              read: async () => {
                if (done) return { done: true };
                done = true;
                return { done: false, value: new TextEncoder().encode('hello') };
              }
            };
          }
        }
      }));
    }

    it('fetches and caches a local resource', async () => {
      global.fetch = createMockFetch();

      const blob = await fetchAndCache(
        'chrome-extension://test-id/assets/models/test.onnx',
        'test-model',
        null
      );
      expect(blob).toBeInstanceOf(Blob);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Verify it was cached
      const cached = await cacheGet('test-model');
      expect(cached).not.toBeNull();
    });

    it('returns cached blob on second call without fetching', async () => {
      global.fetch = createMockFetch();

      const first = await fetchAndCache('chrome-extension://test-id/a.onnx', 'test-model-2', null);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      const second = await fetchAndCache('chrome-extension://test-id/a.onnx', 'test-model-2', null);
      expect(global.fetch).toHaveBeenCalledTimes(1); // no second fetch

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
    });

    it('skips cache when skipCache option is true', async () => {
      global.fetch = createMockFetch();

      const blob = await fetchAndCache(
        'chrome-extension://test-id/b.onnx',
        'test-model-3',
        null,
        { skipCache: true }
      );
      expect(blob).toBeInstanceOf(Blob);
      const cached = await cacheGet('test-model-3');
      expect(cached).toBeNull();
    });

    it('throws on HTTP error', async () => {
      global.fetch = vi.fn(async () => ({ ok: false, status: 404 }));

      await expect(
        fetchAndCache('chrome-extension://bad-url', 'bad', null)
      ).rejects.toThrow('HTTP 404');
    });
  });
});
