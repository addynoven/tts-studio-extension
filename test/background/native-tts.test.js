import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  speakNative,
  stopNative,
  pauseNative,
  resumeNative,
  getNativeVoices,
  isNativeSpeaking
} from '../../src/background/native-tts.js';

describe('native-tts service', () => {
  beforeEach(() => {
    stopNative();
    vi.clearAllMocks();
  });

  it('retrieves native voices from chrome.tts', async () => {
    const voices = await getNativeVoices();
    expect(Array.isArray(voices)).toBe(true);
    expect(voices.length).toBeGreaterThan(0);
    expect(voices[0].voiceName).toBe('native-default');
  });

  it('speaks text and triggers callbacks', async () => {
    const onStart = vi.fn();
    const onWord = vi.fn();
    const onEnd = vi.fn();

    await speakNative('Hello world. This is test.', {
      voice: 'native-default',
      speed: 1.0,
      onStart,
      onWord,
      onEnd
    });

    expect(chrome.tts.speak).toHaveBeenCalled();
    expect(onStart).toHaveBeenCalled();
    expect(onWord).toHaveBeenCalledWith(0, 4, 0);
  });

  it('stops playback and resets state', () => {
    vi.mocked(chrome.tts.speak).mockImplementationOnce(() => {});
    speakNative('Test sentence');
    expect(isNativeSpeaking()).toBe(true);
    stopNative();
    expect(chrome.tts.stop).toHaveBeenCalled();
    expect(isNativeSpeaking()).toBe(false);
  });

  it('pauses and resumes native playback', () => {
    pauseNative();
    expect(chrome.tts.pause).toHaveBeenCalled();
    resumeNative();
    expect(chrome.tts.resume).toHaveBeenCalled();
  });
});
