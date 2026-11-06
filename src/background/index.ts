/**
 * Background Service Worker — Entry Point
 * Wires together all background modules.
 * Central router forwarding messages between popup ↔ offscreen ↔ content scripts.
 */

import { MSG, defaultVoiceForModel } from '../shared/constants.js';
import { ensureOffscreen, closeOffscreen } from './offscreen-manager.js';
import { initContextMenus } from './context-menus.js';
import { initCommands } from './commands.js';
import { initStateSync } from './state-manager.js';
import { speakNative, stopNative, pauseNative, isNativeSpeaking } from './native-tts.js';
import { log } from '../shared/logger.js';
import { setModuleStatus, recordError } from '../shared/state-tracker.js';
import { getSettings } from '../shared/storage.js';

interface ArticleData {
  title?: string;
  text?: string;
}

// ── Initialize modules ─────────────────────────────────────────────────────

initContextMenus();
initCommands();
initStateSync();

// Close any stale offscreen document from a previous extension session
closeOffscreen().catch(() => {});

// ── Offscreen ready tracking ───────────────────────────────────────────────

let offscreenReady = false;
const offscreenMessageQueue: Array<Record<string, unknown>> = [];

function flushOffscreenQueue(): void {
  while (offscreenMessageQueue.length > 0) {
    const msg = offscreenMessageQueue.shift();
    if (!msg) continue;
    chrome.runtime.sendMessage({
      ...msg,
      _forwarded: true
    }).catch((e: Error) => {
      log('bg', 'error', 'Failed to forward queued message to offscreen:', e.message);
    });
  }
}

function sendToOffscreen(message: Record<string, unknown>): void {
  ensureOffscreen().then(() => {
    setModuleStatus('offscreen', 'active');
    if (offscreenReady) {
      chrome.runtime.sendMessage({ ...message, _forwarded: true }).catch((e: Error) => {
        log('bg', 'error', 'Failed to send to offscreen:', e.message);
        recordError('bg', e.message);
      });
    } else {
      log('bg', 'log', 'Queueing message for offscreen:', message.type);
      offscreenMessageQueue.push(message);
    }
  }).catch((e: Error) => {
    log('bg', 'error', 'ensureOffscreen failed:', e.message);
    recordError('bg', e.message);
    setModuleStatus('offscreen', 'error');
  });
}

// ── Helper: forward to active tab's content script ─────────────────────────

function forwardToContent(message: Record<string, unknown>): void {
  chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const tab = tabs[0];
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { ...message, _forwarded: true }).catch(() => {});
    }
  });
}

// ── Message router ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message._forwarded) return false;

  setModuleStatus('bg', 'active');
  log('bg', 'log', 'Received:', message.type || '(no type)', '| target:', message.target || '(no target)');

  // ── Offscreen announces it's ready ──
  if (message.type === MSG.OFFSCREEN_READY) {
    log('bg', 'log', 'Offscreen ready');
    offscreenReady = true;
    flushOffscreenQueue();
    return false;
  }

  // ── Popup asks us to create offscreen doc ──
  if (message.type === MSG.ENSURE_OFFSCREEN) {
    ensureOffscreen()
      .then(() => {
        log('bg', 'log', 'Offscreen document ensured');
        setModuleStatus('offscreen', 'active');
        sendResponse({ ok: true });
      })
      .catch((e: Error) => {
        log('bg', 'error', 'ensureOffscreen failed:', e.message);
        recordError('bg', e.message);
        setModuleStatus('offscreen', 'error');
        sendResponse({ ok: false, error: e.message });
      });
    return true;
  }

  // ── Streaming: BLOCK_READY from content → forward to offscreen as TTS_BUFFER ──
  if (message.type === MSG.BLOCK_READY) {
    log('bg', 'log', 'Streaming block', message.block?.index, '| last:', message.block?.isLastBlock);
    sendToOffscreen({
      target: 'offscreen',
      type: MSG.TTS_BUFFER,
      block: message.block
    });
    return false;
  }

  // ── Streaming: STATUS_NEED_BLOCK from offscreen → forward to content as REQUEST_BLOCK ──
  if (message.type === MSG.STATUS_NEED_BLOCK) {
    log('bg', 'log', 'Offscreen needs block', message.nextBlockIndex);
    forwardToContent({
      type: MSG.REQUEST_BLOCK,
      blockIndex: message.nextBlockIndex
    });
    return false;
  }

  // ── Streaming: STREAM_START from popup/commands → forward to content ──
  if (message.type === MSG.STREAM_START) {
    log('bg', 'log', 'STREAM_START received, forwarding to content');
    forwardToContent(message);
    return false;
  }

  // ── Native TTS Routing ──
  if (message.type === MSG.TTS_GENERATE && message.model === 'native') {
    log('bg', 'log', 'Native TTS generate requested');
    stopNative();
    speakNative(String(message.text || ''), {
      voice: typeof message.voice === 'string' ? message.voice : undefined,
      speed: Number(message.speed ?? 1.0),
      onStart: () => {
        chrome.runtime.sendMessage({ target: 'popup', type: MSG.STATUS_PLAYING, _forwarded: true }).catch(() => {});
        forwardToContent({ type: MSG.STATUS_PLAYING });
      },
      onWord: (charIndex, charLength) => {
        forwardToContent({ type: MSG.HIGHLIGHT_WORD, charIndex, charLength });
      },
      onEnd: () => {
        chrome.runtime.sendMessage({ target: 'popup', type: MSG.STATUS_DONE, _forwarded: true }).catch(() => {});
        forwardToContent({ type: MSG.STATUS_DONE });
      },
      onError: (err) => {
        chrome.runtime.sendMessage({ target: 'popup', type: MSG.STATUS_ERROR, error: err, _forwarded: true }).catch(() => {});
      }
    });
    return false;
  }

  if (message.type === MSG.TTS_STOP) {
    stopNative();
  }

  if (message.type === MSG.TTS_TOGGLE_PLAYBACK) {
    if (isNativeSpeaking()) {
      pauseNative();
      return false;
    }
  }

  // ── Popup/commands → offscreen ──
  if (message.target === 'offscreen') {
    log('bg', 'log', 'Forwarding to offscreen:', message.type);
    ensureOffscreen()
      .then(() => {
        setModuleStatus('offscreen', 'active');
        chrome.runtime.sendMessage({ ...message, _forwarded: true }).catch((e: Error) => {
          log('bg', 'error', 'Failed to forward to offscreen:', e.message);
        });
      })
      .catch((e: Error) => {
        log('bg', 'error', 'ensureOffscreen failed:', e.message);
      });
    return false;
  }

  // ── Offscreen → popup (status updates, errors, progress) ──
  if (message.target === 'popup') {
    log('bg', 'log', 'Forwarding to popup:', message.type);
    chrome.runtime.sendMessage({ ...message, _forwarded: true }).catch(() => {
      // Popup may be closed
    });
    return false;
  }

  // ── Offscreen → content script (highlighting) ──
  if (message.target === 'content') {
    log('bg', 'log', 'Forwarding to content:', message.type);
    forwardToContent(message);
    return false;
  }

  // ── Content script → background (legacy batch mode) ──
  if (message.type === MSG.ARTICLE_EXTRACTED) {
    console.log('[TTS Studio] BG received ARTICLE_EXTRACTED:', message.article?.title);
    log('bg', 'log', 'Article extracted:', message.article?.title);
    const article = message.article as ArticleData | undefined;
    if (article?.text) {
      getSettings().then((settings) => {
        const model = settings.defaultModel;
        const voice = settings.defaultVoice || defaultVoiceForModel(model);
        const speed = settings.defaultSpeed;
        const useGPU = settings.executionProvider === 'webgpu';
        console.log('[TTS Studio] BG forwarding TTS_GENERATE. model:', model, '| voice:', voice);
        sendToOffscreen({
          target: 'offscreen',
          type: MSG.TTS_GENERATE,
          text: article.text,
          model,
          voice,
          speed: Number(speed),
          useGPU
        });
      });
    }
    return false;
  }
});

log('bg', 'log', 'Background service worker initialized');
