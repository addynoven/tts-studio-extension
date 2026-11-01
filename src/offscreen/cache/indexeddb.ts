/**
 * IndexedDB persistent cache for model files.
 * Models are large (~75MB Piper, ~24MB Kitten) and cached in IndexedDB.
 */

const DB_NAME = 'tts-studio-cache';
const DB_VERSION = 1;
const CACHE_VERSION = 1;
let dbInstance: IDBDatabase | null = null;

async function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('models')) {
        db.createObjectStore('models');
      }
    };
    req.onsuccess = (e) => {
      dbInstance = (e.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

function versionedKey(key: string): string {
  return `v${CACHE_VERSION}:${key}`;
}

export async function cacheGet(key: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readonly');
    const req = tx.objectStore('models').get(versionedKey(key));
    req.onsuccess = (e) => resolve(((e.target as IDBRequest).result as Blob) ?? null);
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

export async function cacheSet(key: string, value: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readwrite');
    const req = tx.objectStore('models').put(value, versionedKey(key));
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

export async function cacheDelete(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readwrite');
    const req = tx.objectStore('models').delete(versionedKey(key));
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

export async function cacheClear(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readwrite');
    const req = tx.objectStore('models').clear();
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

export async function cacheListKeys(): Promise<IDBValidKey[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readonly');
    const req = tx.objectStore('models').getAllKeys();
    req.onsuccess = (e) => resolve((e.target as IDBRequest).result);
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

export interface FetchAndCacheOptions {
  skipCache?: boolean;
}

/**
 * Fetch a binary resource, using IndexedDB as a persistent cache.
 */
export async function fetchAndCache(
  url: string,
  cacheKey: string,
  onProgress?: ((percent: number) => void) | null,
  options: FetchAndCacheOptions = {}
): Promise<Blob> {
  const { skipCache = false } = options;

  if (!skipCache) {
    const cached = await cacheGet(cacheKey);
    if (cached) {
      console.log(`[TTS Studio] Cache hit: ${cacheKey}`);
      if (onProgress) onProgress(100);
      return cached;
    }
  }

  console.log(`[TTS Studio] Loading: ${cacheKey}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  if (total > 0 && response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (onProgress) {
        onProgress(Math.round((received / total) * 100));
      }
    }

    const blob = new Blob(chunks as BlobPart[]);
    if (!skipCache) {
      await cacheSet(cacheKey, blob);
      console.log(`[TTS Studio] Cached: ${cacheKey} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
    }
    return blob;
  }

  const blob = await response.blob();
  if (!skipCache) {
    await cacheSet(cacheKey, blob);
    console.log(`[TTS Studio] Cached: ${cacheKey} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
  }
  if (onProgress) onProgress(100);
  return blob;
}
