/**
 * IndexedDB persistent cache for model files.
 *
 * Models are large (~75MB Piper, ~24MB Kitten) and never change.
 * We cache them in IndexedDB so they survive:
 *   - Extension reload / update
 *   - Service worker restart
 *   - Offscreen document close/open
 *   - Browser restart
 *
 * Cache versioning: bump CACHE_VERSION when model files change so
 * old cached entries are auto-replaced.
 */

const DB_NAME = 'tts-studio-cache';
const DB_VERSION = 1;
const CACHE_VERSION = 1; // Bump when model files change
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

function versionedKey(key) {
  return `v${CACHE_VERSION}:${key}`;
}

export async function cacheGet(key) {
  const _db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = _db.transaction('models', 'readonly');
    const req = tx.objectStore('models').get(versionedKey(key));
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror = e => reject(e.target.error);
  });
}

export async function cacheSet(key, value) {
  const _db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = _db.transaction('models', 'readwrite');
    const req = tx.objectStore('models').put(value, versionedKey(key));
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}

export async function cacheDelete(key) {
  const _db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = _db.transaction('models', 'readwrite');
    const req = tx.objectStore('models').delete(versionedKey(key));
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}

export async function cacheClear() {
  const _db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = _db.transaction('models', 'readwrite');
    const req = tx.objectStore('models').clear();
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}

export async function cacheListKeys() {
  const _db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = _db.transaction('models', 'readonly');
    const req = tx.objectStore('models').getAllKeys();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

/**
 * Fetch a binary resource, using IndexedDB as a persistent cache.
 *
 * @param {string} url - Resource URL
 * @param {string} cacheKey - Cache key (e.g. 'piper-onnx')
 * @param {function} onProgress - (percent) => void
 * @param {object} options - { skipCache: boolean }
 * @returns {Promise<Blob>}
 */
export async function fetchAndCache(url, cacheKey, onProgress, options = {}) {
  const { skipCache = false } = options;

  // Try cache first (even for chrome-extension:// URLs)
  if (!skipCache) {
    const cached = await cacheGet(cacheKey);
    if (cached) {
      console.log(`[TTS Studio] Cache hit: ${cacheKey}`);
      return cached;
    }
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

  if (!skipCache) {
    await cacheSet(cacheKey, blob);
    console.log(`[TTS Studio] Cached: ${cacheKey} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
  }

  return blob;
}
