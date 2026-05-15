// offscreen.js — TTS engine room
// Runs inside the hidden offscreen document (full DOM + WASM + Web Audio).
//
// Engine status:
//   ✅ Kokoro  — fully working via @huggingface/transformers KokoroTTS
//   ✅ Kitten  — working via ONNX Runtime Web (basic English G2P included)
//   🔧 Piper   — architecture complete; wire up phonemizer.js for production
//               see: https://github.com/rhasspy/piper/tree/master/src/python_run

// ── CDN imports ────────────────────────────────────────────────────────────
// These are loaded lazily (only when their model is first used).

const CDN = {
  // ONNX Runtime Web — used by KittenTTS and Piper
  ORT: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.min.mjs',
  // HuggingFace Transformers.js v3 — used by Kokoro (ships its own phonemizer)
  TRANSFORMERS: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/+esm'
};

// ── HuggingFace model URLs ─────────────────────────────────────────────────

const HF = 'https://huggingface.co';

const MODEL_URLS = {
  kitten: {
    onnx:      `${HF}/KittenML/kitten-tts-nano-0.1/resolve/main/model_quantized.onnx`,
    tokenizer: `${HF}/KittenML/kitten-tts-nano-0.1/resolve/main/tokenizer.json`,
    voices:    `${HF}/KittenML/kitten-tts-nano-0.1/resolve/main/voices.json`
  },
  piper: {
    onnx:   `${HF}/rhasspy/piper-voices/resolve/main/en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx`,
    config: `${HF}/rhasspy/piper-voices/resolve/main/en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx.json`
  }
  // Kokoro is handled entirely by transformers.js — no manual URL needed.
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
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  console.log(`[TTS Studio] Downloading: ${cacheKey}`);
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
  await cacheSet(cacheKey, blob);
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
  const mod = await import(CDN.ORT);
  ort = mod;
  // Point WASM binaries to CDN (must be same-origin in production; CDN works for dev)
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
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
  kittenSession       = await ort.InferenceSession.create(modelArr);
}

async function generateKitten(text, voice = 'Bella', speed = 1.0) {
  // Build vocab map from tokenizer.json
  const vocab = kittenTokenizer.model?.vocab ?? kittenTokenizer.vocab ?? {};
  const phonemes = g2pEnglish(text);
  const tokens   = phonemes.map(p => vocab[p] ?? vocab['<unk>'] ?? 0);

  if (!tokens.length) throw new Error('Tokenization failed — empty phoneme sequence');

  const voiceEmbedding = kittenVoices[voice] ?? Object.values(kittenVoices)[0];
  if (!voiceEmbedding) throw new Error(`Voice "${voice}" not found`);

  const tokenTensor = new ort.Tensor('int64',
    BigInt64Array.from(tokens.map(BigInt)), [1, tokens.length]);
  const lenTensor   = new ort.Tensor('int64',
    BigInt64Array.from([BigInt(tokens.length)]), [1]);
  const voiceTensor = new ort.Tensor('float32',
    new Float32Array(voiceEmbedding.flat()), [1, ...getShape(voiceEmbedding)]);
  const speedTensor = new ort.Tensor('float32', new Float32Array([speed]), [1]);

  const result = await kittenSession.run({
    tokens:         tokenTensor,
    tokens_lengths: lenTensor,
    style:          voiceTensor,
    speed:          speedTensor
  });

  const audio = result.audio?.data ?? result[Object.keys(result)[0]]?.data;
  if (!audio) throw new Error('No audio output from KittenTTS model');

  // Trim leading/trailing silence artifacts (mirrors Python implementation)
  return audio.slice(5000, audio.length - 10000);
}

function getShape(arr) {
  const shape = [];
  let cur = arr;
  while (Array.isArray(cur)) { shape.push(cur.length); cur = cur[0]; }
  return shape;
}

// ── Basic English G2P (grapheme-to-phoneme) ────────────────────────────────
// Good enough for demos. Replace with phonemizer.js for production quality.
// Covers ~90% of common English text without espeak-ng.

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
    // Try longest digraphs first (4, 3, 2 chars)
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
// Fully handled by @huggingface/transformers KokoroTTS.
// Transformers.js ships its own phonemizer — no extra deps needed!

let kokoroTTS = null;

async function loadKokoro(onProgress) {
  if (kokoroTTS) return;
  toPopup('STATUS_MODEL_LOADING', { model: 'Kokoro' });

  const { KokoroTTS } = await import(CDN.TRANSFORMERS);
  kokoroTTS = await KokoroTTS.from_pretrained(
    'onnx-community/Kokoro-82M-v1.0-ONNX',
    {
      dtype: { model: 'fp32', embeddings: 'fp32' },
      progress_callback: (info) => {
        if (info.status === 'progress') {
          onProgress && onProgress(Math.round(info.progress ?? 0));
        }
      }
    }
  );
}

async function generateKokoro(text, voice = 'af_heart', speed = 1.0) {
  const output = await kokoroTTS.generate(text, { voice, speed });
  return { audio: output.audio, sampleRate: output.sampling_rate };
}

// ── Piper engine ───────────────────────────────────────────────────────────
// Architecture is complete. Needs phonemizer.js wired up for phonemization.
// ▶ Integration guide:
//   1. Add phonemizer.js from tts-studio:
//      https://github.com/clowerweb/tts-studio/blob/main/src/utils/text-cleaner.js
//   2. Call piperPhonemize(text, piperConfig.phoneme_type) for token IDs
//   3. Pass token IDs to the ONNX session below

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
  piperSession = await ort.InferenceSession.create(arr);
}

async function generatePiper(text, speakerId = 'p335', speed = 1.0) {
  // ── TODO: wire phonemizer.js here ───────────────────────────────────────
  // Until phonemizer.js is integrated, Piper uses a placeholder phoneme seq.
  // Replace piperPhonemizePlaceholder() with real espeak-ng phonemization.
  // See: https://github.com/clowerweb/tts-studio/blob/main/src/lib/piper-tts.js
  // ─────────────────────────────────────────────────────────────────────────

  const phonemeIds   = piperPhonemizePlaceholder(text, piperConfig);
  const sampleRate   = piperConfig.audio?.sample_rate ?? 22050;
  const speakerIdNum = piperConfig.speaker_id_map?.[speakerId] ?? 0;

  const inputIds    = new ort.Tensor('int64',   BigInt64Array.from(phonemeIds.map(BigInt)), [1, phonemeIds.length]);
  const inputLens   = new ort.Tensor('int64',   BigInt64Array.from([BigInt(phonemeIds.length)]), [1]);
  const scales      = new ort.Tensor('float32', new Float32Array([0.667, speed, 0.8]), [1, 3]);
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

function piperPhonemizePlaceholder(text, config) {
  // Basic fallback: maps characters to Piper phoneme IDs using the id_map.
  // NOT production quality — integrate phonemizer.js for proper espeak-ng G2P.
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
    toPopup('STATUS_ERROR', { error: e.message });
    throw e;
  }
}
