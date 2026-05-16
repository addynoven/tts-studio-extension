import { describe, it, expect } from 'vitest';
import {
  VOICES,
  DEFAULTS,
  defaultVoiceForModel,
  MODEL_COLORS,
  MODEL_LABELS,
  LIB_PATHS,
  MODEL_PATHS,
  STORAGE_KEYS,
  MSG
} from '../../src/shared/constants.js';

describe('constants', () => {
  describe('VOICES', () => {
    it('has kitten voices', () => {
      expect(VOICES.kitten.length).toBe(8);
      expect(VOICES.kitten[0].id).toBe('Bella');
    });

    it('has empty piper voices (loaded dynamically)', () => {
      expect(VOICES.piper).toEqual([]);
    });
  });

  describe('DEFAULTS', () => {
    it('has expected default values', () => {
      expect(DEFAULTS.model).toBe('piper');
      expect(DEFAULTS.voice).toBe('3922');
      expect(DEFAULTS.speed).toBe(1.0);
      expect(DEFAULTS.useGPU).toBe(false);
    });
  });

  describe('defaultVoiceForModel', () => {
    it('returns Bella for kitten', () => {
      expect(defaultVoiceForModel('kitten')).toBe('Bella');
    });

    it('returns 3922 for piper', () => {
      expect(defaultVoiceForModel('piper')).toBe('3922');
    });

    it('returns 3922 for unknown model', () => {
      expect(defaultVoiceForModel('unknown')).toBe('3922');
    });
  });

  describe('MODEL_COLORS', () => {
    it('has colors for both models', () => {
      expect(MODEL_COLORS.kitten).toMatch(/^#/);
      expect(MODEL_COLORS.piper).toMatch(/^#/);
    });
  });

  describe('MODEL_LABELS', () => {
    it('has labels for both models', () => {
      expect(MODEL_LABELS.kitten).toBe('Kitten');
      expect(MODEL_LABELS.piper).toBe('Piper');
    });
  });

  describe('LIB_PATHS', () => {
    it('points to ORT and phonemizer', () => {
      expect(LIB_PATHS.ORT).toContain('ort.min.mjs');
      expect(LIB_PATHS.PHONEMIZER).toContain('phonemizer.mjs');
    });
  });

  describe('MODEL_PATHS', () => {
    it('has onnx path for kitten', () => {
      expect(MODEL_PATHS.kitten.onnx).toContain('.onnx');
      expect(MODEL_PATHS.kitten.tokenizer).toContain('.json');
      expect(MODEL_PATHS.kitten.voices).toContain('.json');
    });

    it('has onnx and config for piper', () => {
      expect(MODEL_PATHS.piper.onnx).toContain('.onnx');
      expect(MODEL_PATHS.piper.config).toContain('.json');
    });
  });

  describe('STORAGE_KEYS', () => {
    it('has expected keys', () => {
      expect(STORAGE_KEYS.SETTINGS).toBe('settings');
      expect(STORAGE_KEYS.PLAYBACK).toBe('playback');
      expect(STORAGE_KEYS.HISTORY).toBe('history');
    });
  });

  describe('MSG', () => {
    it('has all message types as strings', () => {
      expect(typeof MSG.TTS_GENERATE).toBe('string');
      expect(typeof MSG.TTS_PAUSE).toBe('string');
      expect(typeof MSG.TTS_RESUME).toBe('string');
      expect(typeof MSG.TTS_STOP).toBe('string');
      expect(typeof MSG.TTS_SKIP_FORWARD).toBe('string');
      expect(typeof MSG.TTS_SKIP_BACKWARD).toBe('string');
      expect(typeof MSG.STATUS_PLAYING).toBe('string');
      expect(typeof MSG.STATUS_PAUSED).toBe('string');
      expect(typeof MSG.STATUS_DONE).toBe('string');
      expect(typeof MSG.STATUS_ERROR).toBe('string');
      expect(typeof MSG.EXTRACT_ARTICLE).toBe('string');
      expect(typeof MSG.ARTICLE_EXTRACTED).toBe('string');
      expect(typeof MSG.GET_SELECTION).toBe('string');
      expect(typeof MSG.HIGHLIGHT_CHUNK).toBe('string');
      expect(typeof MSG.CLEAR_HIGHLIGHTS).toBe('string');
      expect(typeof MSG.ENSURE_OFFSCREEN).toBe('string');
      expect(typeof MSG.STREAM_START).toBe('string');
      expect(typeof MSG.REQUEST_BLOCK).toBe('string');
      expect(typeof MSG.BLOCK_READY).toBe('string');
      expect(typeof MSG.TTS_BUFFER).toBe('string');
      expect(typeof MSG.STATUS_NEED_BLOCK).toBe('string');
      expect(typeof MSG.HIGHLIGHT_BLOCK).toBe('string');
      expect(typeof MSG.STREAM_END).toBe('string');
    });

    it('has unique message type values', () => {
      const values = Object.values(MSG);
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    });
  });
});
