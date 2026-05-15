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
  piper: [] // Loaded dynamically from Piper config
};

// ── Model defaults ─────────────────────────────────────────────────────────

export const DEFAULTS = {
  model: 'piper',
  voice: '3922',
  speed: 1.0,
  useGPU: false
};

export function defaultVoiceForModel(model) {
  const defaults = {
    kitten: 'Bella',
    piper: '3922' // libritts_r speaker id
  };
  return defaults[model] || '3922';
}

// ── Model accent colors (for UI theming) ───────────────────────────────────

export const MODEL_COLORS = {
  kitten: '#fbbf24',
  piper: '#22d3ee'
};

export const MODEL_LABELS = {
  kitten: 'Kitten',
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
  TTS_PAUSE: 'TTS_PAUSE',
  TTS_RESUME: 'TTS_RESUME',

  // Offscreen → Popup
  STATUS_MODEL_LOADING: 'STATUS_MODEL_LOADING',
  STATUS_GENERATING: 'STATUS_GENERATING',
  STATUS_PLAYING: 'STATUS_PLAYING',
  STATUS_PAUSED: 'STATUS_PAUSED',
  STATUS_DONE: 'STATUS_DONE',
  STATUS_ERROR: 'STATUS_ERROR',
  STATUS_PROGRESS: 'STATUS_PROGRESS',

  // Background ↔ Content
  EXTRACT_ARTICLE: 'EXTRACT_ARTICLE',
  ARTICLE_EXTRACTED: 'ARTICLE_EXTRACTED',
  GET_SELECTION: 'GET_SELECTION',

  // Offscreen → Content (via background) — chunk-level highlighting
  HIGHLIGHT_CHUNK: 'HIGHLIGHT_CHUNK',
  CLEAR_HIGHLIGHTS: 'CLEAR_HIGHLIGHTS'
};
