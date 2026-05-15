// offscreen.js — TTS engine room
// Runs inside the hidden offscreen document (full DOM + WASM + Web Audio).
//
// Engine status:
//   ✅ Kokoro  — working via ONNX Runtime Web + phonemizer.js + local voice embeddings
//   ✅ Kitten  — working via ONNX Runtime Web + phonemizer.js (espeak-ng WASM)
//   ✅ Piper   — working via ONNX Runtime Web + phonemizer.js (espeak-ng WASM)
//               see: https://github.com/rhasspy/piper/tree/master/src/python_run

// ── Local library imports ──────────────────────────────────────────────────
// Chrome MV3 CSP bans external URLs in script-src. All deps are bundled locally
// in ../lib/ and imported via chrome.runtime.getURL() for cross-origin safety.

const LIB_BASE = chrome.runtime.getURL('lib/');

const LIB = {
  // ONNX Runtime Web — used by KittenTTS and Piper
  ORT:         LIB_BASE + 'ort.min.mjs',
  // phonemizer.js — espeak-ng compiled to WASM, by xenova
  PHONEMIZER:   LIB_BASE + 'phonemizer.mjs'
};



// ── Local model paths ──────────────────────────────────────────────────────
// All models are bundled locally so the extension works offline. No downloads
// needed after installation. Paths are resolved via chrome.runtime.getURL().

const MODEL_BASE = chrome.runtime.getURL('models/');

const MODEL_URLS = {
  kitten: {
    onnx:      MODEL_BASE + 'kitten-tts/model_quantized.onnx',
    tokenizer: MODEL_BASE + 'kitten-tts/tokenizer.json',
    voices:    MODEL_BASE + 'kitten-tts/voices.json'
  },
  piper: {
    onnx:   MODEL_BASE + 'piper/en_US-libritts_r-medium.onnx',
    config: MODEL_BASE + 'piper/en_US-libritts_r-medium.onnx.json'
  },
  kokoro: {
    onnx:      MODEL_BASE + 'kokoro/model_quantized.onnx',
    tokenizer: MODEL_BASE + 'kokoro/tokenizer.json',
    voices:    MODEL_BASE + 'kokoro/voices/'
  }
};

// ── IndexedDB cache ────────────────────────────────────────────────────────

const DB_NAME    = 'tts-studio-cache';
const DB_VERSION = 1;
let   db         = null;

async function openDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('models');
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror   = e => reject(e.target.error);
  });
}

async function cacheGet(key) {
  const _db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = _db.transaction('models', 'readonly');
    const req = tx.objectStore('models').get(key);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });
}

async function cacheSet(key, value) {
  const _db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = _db.transaction('models', 'readwrite');
    const req = tx.objectStore('models').put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

/** Fetch a binary resource, using IndexedDB as a persistent cache. */
async function fetchAndCache(url, cacheKey, onProgress) {
  // For local extension files, skip IndexedDB and fetch directly.
  // For remote URLs, use the cache as before.
  const isLocal = url.startsWith('chrome-extension://');

  if (!isLocal) {
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;
  }

  console.log(`[TTS Studio] Loading: ${cacheKey}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

  const total  = parseInt(res.headers.get('content-length') || '0', 10);
  const reader = res.body.getReader();
  const chunks = [];
  let   loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total && onProgress) onProgress(Math.round((loaded / total) * 100));
  }

  const blob = new Blob(chunks);

  // Only cache remote downloads; local files are already on disk
  if (!isLocal) {
    await cacheSet(cacheKey, blob);
  }

  return blob;
}

// ── Message helpers ────────────────────────────────────────────────────────

function toPopup(type, extra = {}) {
  chrome.runtime.sendMessage({ target: 'popup', type, ...extra });
}

// ── Audio playback ─────────────────────────────────────────────────────────

let audioCtx = null;
let audioSource = null;

function getAudioCtx() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

async function playFloat32(audioData, sampleRate) {
  const ctx    = getAudioCtx();
  const buffer = ctx.createBuffer(1, audioData.length, sampleRate);
  buffer.copyToChannel(audioData, 0);

  // Stop any currently playing audio
  if (audioSource) { try { audioSource.stop(); } catch {} }

  audioSource = ctx.createBufferSource();
  audioSource.buffer = buffer;
  audioSource.connect(ctx.destination);

  return new Promise((resolve) => {
    audioSource.onended = resolve;
    audioSource.start();
    toPopup('STATUS_PLAYING');
  });
}

function stopAudio() {
  if (audioSource) {
    try { audioSource.stop(); } catch {}
    audioSource = null;
  }
}

// ── KittenTTS engine ────────────────────────────────────────────────────────
// Uses ONNX Runtime Web. Phonemization handled by the basic G2P below.
// For production quality, replace g2p() with phonemizer.js (espeak-ng WASM).

let kittenSession   = null;
let kittenTokenizer = null;
let kittenVoices    = null;
let ort             = null;

async function loadORT() {
  if (ort) return ort;
  const mod = await import(LIB.ORT);
  ort = mod;
  ort.env.wasm.wasmPaths = LIB_BASE;
  // Use single-threaded WASM to prevent "Session mismatch" race conditions
  ort.env.wasm.numThreads = 1;
  return ort;
}

async function loadKitten(onProgress) {
  if (kittenSession) return;
  toPopup('STATUS_MODEL_LOADING', { model: 'KittenTTS' });

  await loadORT();

  const [modelBlob, tokenizerBlob, voicesBlob] = await Promise.all([
    fetchAndCache(MODEL_URLS.kitten.onnx,      'kitten-onnx',      onProgress),
    fetchAndCache(MODEL_URLS.kitten.tokenizer,  'kitten-tokenizer', null),
    fetchAndCache(MODEL_URLS.kitten.voices,     'kitten-voices',    null)
  ]);

  const modelArr      = new Uint8Array(await modelBlob.arrayBuffer());
  kittenTokenizer     = JSON.parse(await tokenizerBlob.text());
  kittenVoices        = JSON.parse(await voicesBlob.text());
  kittenSession       = await ort.InferenceSession.create(modelArr, {
    executionProviders: [{ name: 'wasm', simd: true }]
  });
}

async function generateKitten(text, voice = 'Bella', speed = 1.0) {
  // Build vocab map from tokenizer.json
  const vocab = kittenTokenizer.model?.vocab ?? kittenTokenizer.vocab ?? {};
  const { phonemize } = await import(LIB.PHONEMIZER);
  const rawPhonemes = await phonemize(text, 'en-us');

  // phonemizer can return string, array, or object — normalize to string
  let phonemeText;
  if (typeof rawPhonemes === 'string') {
    phonemeText = rawPhonemes;
  } else if (Array.isArray(rawPhonemes)) {
    phonemeText = rawPhonemes.join(' ');
  } else if (rawPhonemes && typeof rawPhonemes === 'object') {
    phonemeText = rawPhonemes.text || rawPhonemes.phonemes || String(rawPhonemes);
  } else {
    phonemeText = String(rawPhonemes || text);
  }

  // Wrap with $ boundary tokens (ID 0) — required by the model
  const tokens = [0, ...phonemeText.split('').map(p => vocab[p] ?? 0), 0];

  if (tokens.length <= 2) throw new Error('Tokenization failed — empty phoneme sequence');

  const voiceEmbedding = kittenVoices[voice] ?? Object.values(kittenVoices)[0];
  if (!voiceEmbedding) throw new Error(`Voice "${voice}" not found`);

  // tts-studio uses voiceEmbedding[0] — the first (and only) inner array
  const speakerEmbedding = new Float32Array(voiceEmbedding[0]);
  const inputIds = new BigInt64Array(tokens.map(id => BigInt(id)));

  const result = await kittenSession.run({
    'input_ids': new ort.Tensor('int64', inputIds, [1, inputIds.length]),
    'style':     new ort.Tensor('float32', speakerEmbedding, [1, speakerEmbedding.length]),
    'speed':     new ort.Tensor('float32', new Float32Array([speed]), [1])
  });

  const audio = result.waveform?.data ?? result[Object.keys(result)[0]]?.data;
  if (!audio) throw new Error('No audio output from KittenTTS model');

  // Apply post-processing speed adjustment (resampling) to match tts-studio behavior.
  // The ONNX model receives speed as a duration hint, but actual time-stretching
  // is done by resampling the output waveform.
  if (speed !== 1.0 && audio.length > 0) {
    const newLength = Math.floor(audio.length / speed);
    const resampled = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIndex = Math.floor(i * speed);
      resampled[i] = audio[Math.min(srcIndex, audio.length - 1)];
    }
    return resampled;
  }

  return audio;
}

// ── English G2P (grapheme-to-phoneme) ──────────────────────────────────────
// Uses phonemizer.js (espeak-ng compiled to WASM) via CDN for production
// quality phonemization. Loaded lazily on first use.
//
// Fallback: the basic g2pEnglish() below is kept as a last-resort fallback
// but is no longer the primary path.

const PHONEME_MAP = {
  a:'æ',b:'b',c:'k',d:'d',e:'ɛ',f:'f',g:'ɡ',h:'h',i:'ɪ',j:'dʒ',
  k:'k',l:'l',m:'m',n:'n',o:'ɑ',p:'p',q:'k',r:'ɹ',s:'s',t:'t',
  u:'ʌ',v:'v',w:'w',x:'ks',y:'j',z:'z',
  ' ': ' ', '.':'.', ',':',', '!':'!', '?':'?'
};

const DIGRAPHS = {
  'th':'ð','sh':'ʃ','ch':'tʃ','wh':'w','ph':'f','gh':'','ng':'ŋ',
  'oo':'uː','ee':'iː','ea':'iː','ai':'eɪ','ay':'eɪ','oi':'ɔɪ',
  'ou':'aʊ','ow':'aʊ','ew':'juː','ue':'juː','ie':'aɪ','igh':'aɪ',
  'tion':'ʃən','sion':'ʒən','ture':'tʃər'
};

function g2pEnglish(text) {
  const phonemes = [];
  const lower    = text.toLowerCase().replace(/[^a-z .,!?]/g, ' ');
  let i = 0;
  while (i < lower.length) {
    let matched = false;
    for (const len of [4, 3, 2]) {
      const chunk = lower.slice(i, i + len);
      if (DIGRAPHS[chunk] !== undefined) {
        if (DIGRAPHS[chunk]) phonemes.push(...DIGRAPHS[chunk].split(''));
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const ph = PHONEME_MAP[lower[i]] ?? lower[i];
      phonemes.push(...ph.split(''));
      i++;
    }
  }
  return phonemes.filter(Boolean);
}

// ── Kokoro engine ──────────────────────────────────────────────────────────
// Local ONNX inference with phonemizer.js + voice embeddings from .bin files.
// Adapted from tts-studio/src/lib/kokoro-tts.js

let kokoroSession = null;
let kokoroTokenizer = null;
let kokoroVoiceEmbeds = {};

async function loadKokoro(onProgress) {
  if (kokoroSession) return;
  toPopup('STATUS_MODEL_LOADING', { model: 'Kokoro' });

  await loadORT();

  const modelBlob = await fetchAndCache(MODEL_URLS.kokoro.onnx, 'kokoro-onnx', onProgress);
  const tokenizerBlob = await fetchAndCache(MODEL_URLS.kokoro.tokenizer, 'kokoro-tokenizer', null);

  const modelArr = new Uint8Array(await modelBlob.arrayBuffer());
  kokoroTokenizer = JSON.parse(await tokenizerBlob.text());

  kokoroSession = await ort.InferenceSession.create(modelArr, {
    executionProviders: [{ name: 'wasm', simd: true }]
  });

  // Small delay to ensure WASM workers are fully ready
  await new Promise(r => setTimeout(r, 100));
}

async function phonemizeKokoro(text, language = 'a') {
  const { phonemize } = await import(LIB.PHONEMIZER);
  const lang = language === 'a' ? 'en-us' : 'en';
  const result = await phonemize(text, lang);

  let phonemeText;
  if (typeof result === 'string') phonemeText = result;
  else if (Array.isArray(result)) phonemeText = result.join(' ');
  else if (result && typeof result === 'object') phonemeText = result.text || result.phonemes || String(result);
  else phonemeText = String(result || text);

  return phonemeText
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .trim();
}

async function loadKokoroVoice(voice) {
  if (kokoroVoiceEmbeds[voice]) return;
  const voiceBase = MODEL_URLS.kokoro.voices;
  try {
    const res = await fetch(voiceBase + voice + '.bin');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    kokoroVoiceEmbeds[voice] = new Float32Array(ab);
  } catch (e) {
    console.error('[Kokoro] Failed to load voice', voice, e);
    throw new Error(`Voice "${voice}" failed to load: ${e.message}`);
  }
}

async function generateKokoro(text, voice = 'af_heart', speed = 1.0) {
  const language = voice.startsWith('a') ? 'a' : 'b';
  const phonemes = await phonemizeKokoro(text, language);

  const vocab = kokoroTokenizer.model?.vocab || {};
  const tokens = [0, ...phonemes.split('').map(ch => vocab[ch] ?? 0), 0];

  // Load voice on-demand (only when needed)
  await loadKokoroVoice(voice);
  const voiceData = kokoroVoiceEmbeds[voice];

  const numTokens = Math.min(Math.max(tokens.length - 2, 0), 509);
  const STYLE_DIM = 256;
  const offset = numTokens * STYLE_DIM;
  const speakerEmbedding = voiceData.slice(offset, offset + STYLE_DIM);

  const inputIds = new BigInt64Array(tokens.map(id => BigInt(id)));

  const inputs = {
    'input_ids': new ort.Tensor('int64', inputIds, [1, inputIds.length]),
    'style': new ort.Tensor('float32', speakerEmbedding, [1, speakerEmbedding.length]),
    'speed': new ort.Tensor('float32', new Float32Array([1.0 / speed]), [1])
  };

  const results = await kokoroSession.run(inputs);
  const audioData = results.waveform?.data || results.output?.data;

  if (!audioData) throw new Error('No audio output from Kokoro model');

  return { audio: new Float32Array(audioData), sampleRate: 24000 };
}

// ── Piper engine ───────────────────────────────────────────────────────────

let piperSession = null;
let piperConfig  = null;

async function loadPiper(onProgress) {
  if (piperSession) return;
  toPopup('STATUS_MODEL_LOADING', { model: 'Piper' });

  await loadORT();

  const [modelBlob, configBlob] = await Promise.all([
    fetchAndCache(MODEL_URLS.piper.onnx,   'piper-onnx',   onProgress),
    fetchAndCache(MODEL_URLS.piper.config, 'piper-config',  null)
  ]);

  piperConfig  = JSON.parse(await configBlob.text());
  const arr    = new Uint8Array(await modelBlob.arrayBuffer());

  // Explicit WASM config with SIMD — prevents "Session mismatch" on first run
  piperSession = await ort.InferenceSession.create(arr, {
    executionProviders: [{ name: 'wasm', simd: true }],
    graphOptimizationLevel: 'all'
  });

  // Small delay to ensure WASM workers are fully ready
  await new Promise(r => setTimeout(r, 100));
}

async function generatePiper(text, speakerId = 'p335', speed = 1.0) {
  const { phonemize } = await import(LIB.PHONEMIZER);
  const voice = piperConfig.espeak?.voice || 'en-us';
  const phonemes = await phonemize(text, voice);

  // phonemizer can return string, array, or object — normalize to string
  let phonemeText;
  if (typeof phonemes === 'string') {
    phonemeText = phonemes;
  } else if (Array.isArray(phonemes)) {
    phonemeText = phonemes.join(' ');
  } else if (phonemes && typeof phonemes === 'object') {
    phonemeText = phonemes.text || phonemes.phonemes || String(phonemes);
  } else {
    phonemeText = String(phonemes || text);
  }

  const phonemeIds = piperTextToIds(phonemeText, piperConfig);
  const sampleRate   = piperConfig.audio?.sample_rate ?? 22050;
  const speakerIdNum = piperConfig.speaker_id_map?.[speakerId] ?? 0;

  // Piper's lengthScale is a duration multiplier: higher = slower speech.
  // User's speed slider is a speed multiplier: 0.5x = slower, 2.0x = faster.
  // Convert: lengthScale = 1.0 / speed
  const lengthScale = 1.0 / speed;
  const inputIds    = new ort.Tensor('int64',   BigInt64Array.from(phonemeIds.map(BigInt)), [1, phonemeIds.length]);
  const inputLens   = new ort.Tensor('int64',   BigInt64Array.from([BigInt(phonemeIds.length)]), [1]);
  const scales      = new ort.Tensor('float32', new Float32Array([0.667, lengthScale, 0.8]), [3]);
  const sidTensor   = new ort.Tensor('int64',   BigInt64Array.from([BigInt(speakerIdNum)]), [1]);

  const result = await piperSession.run({
    input:         inputIds,
    input_lengths: inputLens,
    scales,
    sid:           sidTensor
  });

  const audio = result.output?.data ?? result[Object.keys(result)[0]]?.data;
  return { audio: new Float32Array(audio), sampleRate };
}

function piperTextToIds(phonemeText, config) {
  // Convert espeak-ng phoneme output to Piper phoneme IDs using the id_map.
  const pad  = config.phoneme_id_map?.['<pad>']?.[0]  ?? 0;
  const bos  = config.phoneme_id_map?.['^']?.[0]      ?? 1;
  const eos  = config.phoneme_id_map?.['$']?.[0]      ?? 2;

  const ids = [bos, pad];
  for (const ch of phonemeText.normalize('NFD')) {
    const mapped = config.phoneme_id_map?.[ch];
    if (mapped) {
      ids.push(...mapped);
      ids.push(pad);
    }
  }
  ids.push(eos);
  return ids;
}

// Legacy fallback — kept for reference, no longer used
function piperPhonemizePlaceholder(text, config) {
  const pad  = config.phoneme_id_map?.['<pad>']?.[0]  ?? 0;
  const bos  = config.phoneme_id_map?.['^']?.[0]      ?? 1;
  const eos  = config.phoneme_id_map?.['$']?.[0]      ?? 2;
  const sp   = config.phoneme_id_map?.[' ']?.[0]      ?? 3;

  const ids = [bos];
  for (const ch of text.toLowerCase()) {
    const mapped = config.phoneme_id_map?.[ch];
    if (mapped) ids.push(...mapped);
    else if (ch === ' ') ids.push(sp);
  }
  ids.push(eos);
  return ids;
}

// ── Main message handler ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen') return;

  if (message.type === 'TTS_GENERATE') {
    handleGenerate(message).catch(e => {
      console.error('[TTS Studio]', e);
      toPopup('STATUS_ERROR', { error: e.message });
    });
  }

  if (message.type === 'TTS_STOP') {
    stopAudio();
  }
});

async function handleGenerate({ text, model, voice, speed, useGPU }) {
  stopAudio();
  toPopup('STATUS_GENERATING');

  const onProgress = (pct) => toPopup('STATUS_PROGRESS', { percent: pct });

  try {
    let audioData, sampleRate;

    // ── Kokoro ──────────────────────────────────────────────────────────
    if (model === 'kokoro') {
      await loadKokoro(onProgress);
      const out = await generateKokoro(text, voice, speed);
      audioData  = out.audio;
      sampleRate = out.sampleRate;
    }

    // ── KittenTTS ───────────────────────────────────────────────────────
    else if (model === 'kitten') {
      await loadKitten(onProgress);
      audioData  = await generateKitten(text, voice, speed);
      sampleRate = 24000;
    }

    // ── Piper ───────────────────────────────────────────────────────────
    else if (model === 'piper') {
      await loadPiper(onProgress);
      const out  = await generatePiper(text, voice, speed);
      audioData  = out.audio;
      sampleRate = out.sampleRate;
    }

    else throw new Error(`Unknown model: ${model}`);

    await playFloat32(new Float32Array(audioData), sampleRate);
    toPopup('STATUS_DONE');

  } catch (e) {
    console.error('[TTS Studio]', e);
    toPopup('STATUS_ERROR', { error: e.message });
    throw e;
  }
}
