/**
 * Shared constants across all extension modules.
 * This is the single source of truth for voices, models, and defaults.
 */

// ── Voice definitions ──────────────────────────────────────────────────────

export const VOICES = {
  kitten: [
    { id: 'Bella',  label: 'Bella  (F)' },
    { id: 'Jasper', label: 'Jasper (M)' },
    { id: 'Luna',   label: 'Luna   (F)' },
    { id: 'Bruno',  label: 'Bruno  (M)' },
    { id: 'Rosie',  label: 'Rosie  (F)' },
    { id: 'Hugo',   label: 'Hugo   (M)' },
    { id: 'Kiki',   label: 'Kiki   (F)' },
    { id: 'Leo',    label: 'Leo    (M)' }
  ],
  kokoro: [
    { id: 'af',         label: 'af — Default Female' },
    { id: 'af_alloy',   label: 'Alloy — AF' },
    { id: 'af_aoede',   label: 'Aoede — AF' },
    { id: 'af_bella',   label: 'Bella — AF (bright)' },
    { id: 'af_heart',   label: 'Heart — AF (warm)' },
    { id: 'af_jessica', label: 'Jessica — AF' },
    { id: 'af_kore',    label: 'Kore — AF' },
    { id: 'af_nicole',  label: 'Nicole — AF (smooth)' },
    { id: 'af_nova',    label: 'Nova — AF' },
    { id: 'af_river',   label: 'River — AF' },
    { id: 'af_sarah',   label: 'Sarah — AF (clear)' },
    { id: 'af_sky',     label: 'Sky — AF (airy)' },
    { id: 'am_adam',    label: 'Adam — AM (deep)' },
    { id: 'am_echo',    label: 'Echo — AM' },
    { id: 'am_eric',    label: 'Eric — AM' },
    { id: 'am_fenrir',  label: 'Fenrir — AM' },
    { id: 'am_liam',    label: 'Liam — AM' },
    { id: 'am_michael', label: 'Michael — AM (rich)' },
    { id: 'am_onyx',    label: 'Onyx — AM' },
    { id: 'am_puck',    label: 'Puck — AM' },
    { id: 'am_santa',   label: 'Santa — AM' }
  ],
  piper: [] // Loaded dynamically from Piper config
};

// ── Model defaults ─────────────────────────────────────────────────────────

export const DEFAULTS = {
  model: 'kokoro',
  voice: 'af_heart',
  speed: 1.0,
  useGPU: false
};

export function defaultVoiceForModel(model) {
  const defaults = {
    kitten: 'Bella',
    kokoro: 'af_heart',
    piper: '3922' // libritts_r speaker id
  };
  return defaults[model] || 'af_heart';
}

// ── Model accent colors (for UI theming) ───────────────────────────────────

export const MODEL_COLORS = {
  kitten: '#fbbf24',
  kokoro: '#f472b6',
  piper: '#22d3ee'
};

export const MODEL_LABELS = {
  kitten: 'Kitten',
  kokoro: 'Studio',
  piper: 'Piper'
};

// ─- Library paths ──────────────────────────────────────────────────────────

export const LIB_PATHS = {
  ORT: 'assets/lib/ort.min.mjs',
  PHONEMIZER: 'assets/lib/phonemizer.mjs'
};

// ── Model paths ────────────────────────────────────────────────────────────
// NOTE: These are relative to the extension root. In the built extension,
// assets are placed under assets/ by the build script.

export const MODEL_PATHS = {
  kitten: {
    onnx: 'assets/models/kitten-tts/model_quantized.onnx',
    tokenizer: 'assets/models/kitten-tts/tokenizer.json',
    voices: 'assets/models/kitten-tts/voices.json'
  },
  piper: {
    onnx: 'assets/models/piper/en_US-libritts_r-medium.onnx',
    config: 'assets/models/piper/en_US-libritts_r-medium.onnx.json'
  },
  kokoro: {
    onnx: 'assets/models/kokoro/model_quantized.onnx',
    tokenizer: 'assets/models/kokoro/tokenizer.json',
    voicesDir: 'assets/models/kokoro/voices/'
  }
};

// ── Storage keys ───────────────────────────────────────────────────────────

export const STORAGE_KEYS = {
  SETTINGS: 'settings',
  PLAYBACK: 'playback',
  HISTORY: 'history'
};

// ── Message types ──────────────────────────────────────────────────────────

export const MSG = {
  // Popup → Background
  ENSURE_OFFSCREEN: 'ENSURE_OFFSCREEN',

  // Popup → Offscreen
  TTS_GENERATE: 'TTS_GENERATE',
  TTS_STOP: 'TTS_STOP',

  // Offscreen → Popup
  STATUS_MODEL_LOADING: 'STATUS_MODEL_LOADING',
  STATUS_GENERATING: 'STATUS_GENERATING',
  STATUS_PLAYING: 'STATUS_PLAYING',
  STATUS_DONE: 'STATUS_DONE',
  STATUS_ERROR: 'STATUS_ERROR',
  STATUS_PROGRESS: 'STATUS_PROGRESS',

  // Background ↔ Content
  EXTRACT_ARTICLE: 'EXTRACT_ARTICLE',
  ARTICLE_EXTRACTED: 'ARTICLE_EXTRACTED',
  GET_SELECTION: 'GET_SELECTION',
  HIGHLIGHT_SENTENCE: 'HIGHLIGHT_SENTENCE',
  CLEAR_HIGHLIGHT: 'CLEAR_HIGHLIGHT'
};
