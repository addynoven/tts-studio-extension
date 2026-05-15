/**
 * IndexedDB persistent cache for model files.
 * Avoids re-downloading models on every session.
 */

const DB_NAME = 'tts-studio-cache';
const DB_VERSION = 1;
let db = null;

async function openDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('models');
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}

export async function cacheGet(key) {
  const _db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = _db.transaction('models', 'readonly');
    const req = tx.objectStore('models').get(key);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror = e => reject(e.target.error);
  });
}

export async function cacheSet(key, value) {
  const _db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = _db.transaction('models', 'readwrite');
    const req = tx.objectStore('models').put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}

/**
 * Fetch a binary resource, using IndexedDB as a persistent cache.
 * @param {string} url - Resource URL
 * @param {string} cacheKey - Cache key
 * @param {function} onProgress - (percent) => void
 * @returns {Promise<Blob>}
 */
export async function fetchAndCache(url, cacheKey, onProgress) {
  const isLocal = url.startsWith('chrome-extension://');

  if (!isLocal) {
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;
  }

  console.log(`[TTS Studio] Loading: ${cacheKey}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

  const total = parseInt(res.headers.get('content-length') || '0', 10);
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total && onProgress) onProgress(Math.round((loaded / total) * 100));
  }

  const blob = new Blob(chunks);

  if (!isLocal) {
    await cacheSet(cacheKey, blob);
  }

  return blob;
}
