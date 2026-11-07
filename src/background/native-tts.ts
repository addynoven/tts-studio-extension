/**
 * Native OS TTS Service.
 * Leverages Chrome's chrome.tts API for instant 0ms, zero-battery offline speech.
 * Automatically chunks text to prevent Chrome's 15-second cutoff bug and emits
 * native word boundary events for real-time word-by-word highlighting.
 */

import { splitIntoSentences } from '../shared/sentence-splitter.js';

export interface NativeVoice {
  voiceName: string;
  lang?: string;
  remote?: boolean;
}

export interface NativeSpeakOptions {
  voice?: string;
  speed?: number;
  pitch?: number;
  onStart?: () => void;
  onWord?: (charIndex: number, charLength?: number, sentenceIndex?: number) => void;
  onEnd?: () => void;
  onError?: (err: string) => void;
}

let isSpeaking = false;
let currentSentences: string[] = [];
let currentSentenceIndex = 0;
let currentOptions: NativeSpeakOptions | null = null;

/**
 * Get available native OS voices.
 */
export async function getNativeVoices(): Promise<NativeVoice[]> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.tts?.getVoices) {
      resolve([]);
      return;
    }
    chrome.tts.getVoices((voices) => {
      resolve(
        (voices || []).map((v) => ({
          voiceName: v.voiceName || 'System Default',
          lang: v.lang,
          remote: v.remote
        }))
      );
    });
  });
}

/**
 * Speak text using native OS speech synthesis with sentence chunking.
 */
export async function speakNative(
  text: string,
  options: NativeSpeakOptions = {}
): Promise<void> {
  stopNative();

  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) {
    options.onEnd?.();
    return;
  }

  currentSentences = sentences;
  currentSentenceIndex = 0;
  currentOptions = options;
  isSpeaking = true;

  options.onStart?.();
  speakNextSentence();
}

function speakNextSentence(): void {
  if (!isSpeaking || currentSentenceIndex >= currentSentences.length) {
    isSpeaking = false;
    currentOptions?.onEnd?.();
    return;
  }

  const sentence = currentSentences[currentSentenceIndex];
  const sentenceIdx = currentSentenceIndex;
  const rate = Math.max(0.5, Math.min(2.0, currentOptions?.speed ?? 1.0));
  const reqVoice = currentOptions?.voice;
  // Guard against neural voice ids like 'af_heart' being passed to native OS TTS
  const isNeuralVoiceId = reqVoice && (
    reqVoice.startsWith('af_') ||
    reqVoice.startsWith('am_') ||
    reqVoice.startsWith('bf_') ||
    reqVoice.startsWith('bm_') ||
    reqVoice === 'default'
  );
  const voiceName = (!isNeuralVoiceId && reqVoice && reqVoice !== 'default')
    ? reqVoice
    : undefined;

  chrome.tts.speak(sentence, {
    voiceName,
    rate,
    pitch: currentOptions?.pitch ?? 1.0,
    onEvent: (event) => {
      if (!isSpeaking) return;

      if (event.type === 'word') {
        const charLength = (event as unknown as { charLength?: number; length?: number }).charLength
          ?? (event as unknown as { length?: number }).length
          ?? 0;
        currentOptions?.onWord?.(event.charIndex ?? 0, charLength, sentenceIdx);
      } else if (event.type === 'end') {
        currentSentenceIndex++;
        speakNextSentence();
      } else if (event.type === 'error') {
        isSpeaking = false;
        console.error('[TTS Studio Native] Speech error:', event.errorMessage);
        currentOptions?.onError?.(event.errorMessage || 'Native TTS error');
      }
    }
  });
}

/**
 * Stop active native speech synthesis immediately.
 */
export function stopNative(): void {
  isSpeaking = false;
  currentSentences = [];
  currentSentenceIndex = 0;
  currentOptions = null;
  if (typeof chrome !== 'undefined' && chrome.tts?.stop) {
    chrome.tts.stop();
  }
}

/**
 * Pause native speech.
 */
export function pauseNative(): void {
  if (typeof chrome !== 'undefined' && chrome.tts?.pause) {
    chrome.tts.pause();
  }
}

/**
 * Resume native speech.
 */
export function resumeNative(): void {
  if (typeof chrome !== 'undefined' && chrome.tts?.resume) {
    chrome.tts.resume();
  }
}

/**
 * Skip to next sentence in native speech.
 */
export function skipForwardNative(): void {
  if (!isSpeaking || currentSentences.length === 0) return;
  currentSentenceIndex = Math.min(currentSentenceIndex + 1, currentSentences.length - 1);
  if (typeof chrome !== 'undefined' && chrome.tts?.stop) {
    chrome.tts.stop();
  }
  speakNextSentence();
}

/**
 * Skip to previous sentence in native speech.
 */
export function skipBackwardNative(): void {
  if (!isSpeaking || currentSentences.length === 0) return;
  currentSentenceIndex = Math.max(0, currentSentenceIndex - 1);
  if (typeof chrome !== 'undefined' && chrome.tts?.stop) {
    chrome.tts.stop();
  }
  speakNextSentence();
}

/**
 * Check if native TTS is currently speaking.
 */
export function isNativeSpeaking(): boolean {
  return isSpeaking;
}
