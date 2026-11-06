/**
 * Shared constants across all extension modules.
 * This is the single source of truth for voices, models, and defaults.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type ModelType = 'kokoro' | 'native';
export type MsgType = string;

export interface VoiceDef {
  id: string;
  label: string;
}

// ── Voice definitions ──────────────────────────────────────────────────────

export const VOICES: Record<ModelType, VoiceDef[]> = {
  kokoro: [
    { id: 'af_heart',    label: 'Heart (F - American Warm / Natural)' },
    { id: 'af_bella',    label: 'Bella (F - American Soft)' },
    { id: 'af_nicole',   label: 'Nicole (F - American Whisper)' },
    { id: 'af_aoede',    label: 'Aoede (F - American Melodic)' },
    { id: 'af_kore',     label: 'Kore (F - American Clear)' },
    { id: 'af_sarah',    label: 'Sarah (F - American Articulate)' },
    { id: 'af_nova',     label: 'Nova (F - American Dynamic)' },
    { id: 'af_sky',      label: 'Sky (F - American Bright)' },
    { id: 'af_alloy',    label: 'Alloy (F - American Neutral)' },
    { id: 'af_jessica',  label: 'Jessica (F - American Expressive)' },
    { id: 'af_river',    label: 'River (F - American Calm)' },
    { id: 'am_adam',     label: 'Adam (M - American Narrator)' },
    { id: 'am_michael',  label: 'Michael (M - American Deep / Authoritative)' },
    { id: 'am_fenrir',   label: 'Fenrir (M - American Crisp)' },
    { id: 'am_puck',     label: 'Puck (M - American Casual)' },
    { id: 'am_echo',     label: 'Echo (M - American Smooth)' },
    { id: 'am_eric',     label: 'Eric (M - American Warm)' },
    { id: 'am_liam',     label: 'Liam (M - American Bright)' },
    { id: 'am_onyx',     label: 'Onyx (M - American Rich)' },
    { id: 'am_santa',    label: 'Santa (M - American Friendly)' },
    { id: 'bf_emma',     label: 'Emma (F - British Articulate)' },
    { id: 'bf_isabella', label: 'Isabella (F - British Clear)' },
    { id: 'bf_alice',    label: 'Alice (F - British Gentle)' },
    { id: 'bf_lily',     label: 'Lily (F - British Soft)' },
    { id: 'bm_george',   label: 'George (M - British Warm)' },
    { id: 'bm_lewis',    label: 'Lewis (M - British Classic)' },
    { id: 'bm_daniel',   label: 'Daniel (M - British Refined)' },
    { id: 'bm_fable',    label: 'Fable (M - British Expressive)' }
  ],
  native: [
    { id: 'default', label: 'System Default' }
  ]
};

// ── Model defaults ─────────────────────────────────────────────────────────

export const DEFAULTS = {
  model: 'kokoro',
  voice: 'af_heart',
  speed: 1.0,
  useGPU: true
} as const;

export function defaultVoiceForModel(model: string): string {
  if (model === 'native') return 'default';
  return 'af_heart';
}

// ── Model accent colors (for UI theming) ───────────────────────────────────

export const MODEL_COLORS: Record<ModelType, string> = {
  kokoro: '#10b981',
  native: '#3b82f6'
};

export const MODEL_LABELS: Record<ModelType, string> = {
  kokoro: 'Kokoro-82M (Neural AI)',
  native: 'Instant (Native OS)'
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
