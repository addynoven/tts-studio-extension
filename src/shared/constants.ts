/**
 * Shared constants across all extension modules.
 * This is the single source of truth for voices, models, and defaults.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type ModelType = 'kokoro' | 'native' | 'kitten' | 'piper';
export type MsgType = string;

export interface VoiceDef {
  id: string;
  label: string;
}

// ── Voice definitions ──────────────────────────────────────────────────────

export const VOICES: Record<ModelType, VoiceDef[]> = {
  kokoro: [
    { id: 'af_heart',    label: 'Heart (F - American Natural)' },
    { id: 'af_bella',    label: 'Bella (F - American Soft)' },
    { id: 'af_nicole',   label: 'Nicole (F - American Calm)' },
    { id: 'am_adam',     label: 'Adam (M - American Narrator)' },
    { id: 'am_michael',  label: 'Michael (M - American Deep)' },
    { id: 'bf_emma',     label: 'Emma (F - British Articulate)' },
    { id: 'bf_isabella', label: 'Isabella (F - British Clear)' },
    { id: 'bm_george',   label: 'George (M - British Warm)' },
    { id: 'bm_lewis',    label: 'Lewis (M - British Classic)' }
  ],
  native: [
    { id: 'default', label: 'System Default' }
  ],
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
  model: 'kokoro',
  voice: 'af_heart',
  speed: 1.0,
  useGPU: true
} as const;

export function defaultVoiceForModel(model: string): string {
  const defaults: Record<string, string> = {
    kokoro: 'af_heart',
    native: 'default',
    kitten: 'Bella',
    piper: '3922' // libritts_r speaker id
  };
  return defaults[model] || 'af_heart';
}

// ── Model accent colors (for UI theming) ───────────────────────────────────

export const MODEL_COLORS: Record<ModelType, string> = {
  kokoro: '#10b981',
  native: '#3b82f6',
  kitten: '#fbbf24',
  piper: '#22d3ee'
};

export const MODEL_LABELS: Record<ModelType, string> = {
  kokoro: 'Kokoro (Neural AI)',
  native: 'Instant (Native OS)',
  kitten: 'Kitten',
  piper: 'Piper'
};

// ─- Library paths ──────────────────────────────────────────────────────────

export const LIB_PATHS = {
  ORT: 'assets/lib/ort.min.mjs',
  PHONEMIZER: 'assets/lib/phonemizer.mjs'
} as const;

// ── Model paths ────────────────────────────────────────────────────────────
// NOTE: These are relative to the extension root. In the built extension,
// assets are placed under assets/ by the build script.

export type AssetModelType = 'kitten' | 'piper';
export const MODEL_PATHS: Record<AssetModelType, { onnx: string; tokenizer?: string; voices?: string; config?: string }> = {
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
} as const;

// ── Message types ──────────────────────────────────────────────────────────

export const MSG = {
  // Popup → Background
  ENSURE_OFFSCREEN: 'ENSURE_OFFSCREEN',

  // Popup → Offscreen
  TTS_GENERATE: 'TTS_GENERATE',
  TTS_STOP: 'TTS_STOP',
  TTS_PAUSE: 'TTS_PAUSE',
  TTS_RESUME: 'TTS_RESUME',
  TTS_TOGGLE_PLAYBACK: 'TTS_TOGGLE_PLAYBACK',
  TTS_SKIP_FORWARD: 'TTS_SKIP_FORWARD',
  TTS_SKIP_BACKWARD: 'TTS_SKIP_BACKWARD',

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
  HIGHLIGHT_WORD: 'HIGHLIGHT_WORD',
  CLEAR_HIGHLIGHTS: 'CLEAR_HIGHLIGHTS',

  // Streaming protocol (article read-aloud)
  STREAM_START: 'STREAM_START',
  REQUEST_BLOCK: 'REQUEST_BLOCK',
  BLOCK_READY: 'BLOCK_READY',
  TTS_BUFFER: 'TTS_BUFFER',
  STATUS_NEED_BLOCK: 'STATUS_NEED_BLOCK',
  OFFSCREEN_READY: 'OFFSCREEN_READY',
  HIGHLIGHT_BLOCK: 'HIGHLIGHT_BLOCK',
  STREAM_END: 'STREAM_END'
} as const;
