import { describe, it, expect } from 'vitest';
import {
  VOICES,
  DEFAULTS,
  defaultVoiceForModel,
  MODEL_COLORS,
  MODEL_LABELS,
  STORAGE_KEYS,
  MSG
} from '../../src/shared/constants.js';

describe('constants', () => {
  describe('VOICES', () => {
    it('has kokoro voices', () => {
      expect(VOICES.kokoro.length).toBeGreaterThanOrEqual(9);
      expect(VOICES.kokoro[0].id).toBe('af_heart');
    });

    it('has native system voice', () => {
      expect(VOICES.native.length).toBe(1);
      expect(VOICES.native[0].id).toBe('default');
    });
  });

  describe('DEFAULTS', () => {
    it('has expected default values', () => {
      expect(DEFAULTS.model).toBe('kokoro');
      expect(DEFAULTS.voice).toBe('af_heart');
      expect(DEFAULTS.speed).toBe(1.0);
      expect(DEFAULTS.useGPU).toBe(true);
    });
  });

  describe('defaultVoiceForModel', () => {
    it('returns af_heart for kokoro', () => {
      expect(defaultVoiceForModel('kokoro')).toBe('af_heart');
    });

    it('returns default for native', () => {
      expect(defaultVoiceForModel('native')).toBe('default');
    });

    it('returns af_heart for unknown model', () => {
      expect(defaultVoiceForModel('unknown')).toBe('af_heart');
    });
  });

  describe('MODEL_COLORS', () => {
    it('has colors for models', () => {
      expect(MODEL_COLORS.kokoro).toMatch(/^#/);
      expect(MODEL_COLORS.native).toMatch(/^#/);
    });
  });

  describe('MODEL_LABELS', () => {
    it('has labels for models', () => {
      expect(MODEL_LABELS.kokoro).toContain('Kokoro');
      expect(MODEL_LABELS.native).toContain('Instant');
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
