/**
 * Background Service Worker — Entry Point
 * Wires together all background modules.
 *
 * NOTE: This is a CENTRAL MESSAGE ROUTER. It must handle ALL messages
 * regardless of target field, because it forwards messages between
 * popup ↔ offscreen ↔ content scripts.
 *
 * Streaming protocol additions:
 *   popup/command → STREAM_START → content
 *   content → BLOCK_READY → offscreen (as TTS_BUFFER)
 *   offscreen → STATUS_NEED_BLOCK → content (as REQUEST_BLOCK)
 */

import { MSG, defaultVoiceForModel } from '../shared/constants.js';
import { ensureOffscreen } from './offscreen-manager.js';
import { initContextMenus } from './context-menus.js';
import { initCommands } from './commands.js';
import { initStateSync } from './state-manager.js';
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
  // Prevent infinite forwarding loops — skip messages we already forwarded
  if (message._forwarded) return false;

  setModuleStatus('bg', 'active');
  log('bg', 'log', 'Received:', message.type || '(no type)', '| target:', message.target || '(no target)');

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
    ensureOffscreen().then(() => {
      chrome.runtime.sendMessage({
        target: 'offscreen',
        type: MSG.TTS_BUFFER,
        block: message.block,
        _forwarded: true
      }).catch((e: Error) => {
        log('bg', 'error', 'Failed to forward BLOCK_READY to offscreen:', e.message);
      });
    }).catch((e: Error) => {
      log('bg', 'error', 'ensureOffscreen failed for stream:', e.message);
    });
    return false;
  }

  // ── Streaming: STATUS_NEED_BLOCK from offscreen → forward to content as REQUEST_BLOCK ──
  if (message.type === MSG.STATUS_NEED_BLOCK) {
    log('bg', 'log', 'Offscreen needs block', message.nextBlockIndex);
    forwardToContent({
      type: MSG.REQUEST_BLOCK,
      blockIndex: message.nextBlockIndex,
      _forwarded: true
    });
    return false;
  }

  // ── Streaming: STREAM_START from popup/commands → forward to content ──
  if (message.type === MSG.STREAM_START) {
    log('bg', 'log', 'STREAM_START received, forwarding to content');
    forwardToContent({ ...message, _forwarded: true });
    return false;
  }

  // ── Popup → offscreen (manual mode: generate / stop / pause / resume) ──
  if (message.target === 'offscreen') {
    log('bg', 'log', 'Forwarding to offscreen:', message.type);
    ensureOffscreen().then(() => {
      setModuleStatus('offscreen', 'active');
      chrome.runtime.sendMessage({ ...message, _forwarded: true }).catch((e: Error) => {
        log('bg', 'error', 'Failed to forward to offscreen:', e.message);
        recordError('bg', e.message);
        setModuleStatus('offscreen', 'error');
      });
    }).catch((e: Error) => {
      log('bg', 'error', 'ensureOffscreen failed for forward:', e.message);
      recordError('bg', e.message);
      setModuleStatus('offscreen', 'error');
    });
    return false;
  }

  // ── Offscreen → popup (status updates, errors, progress) ──
  if (message.target === 'popup') {
    log('bg', 'log', 'Forwarding to popup:', message.type);
    chrome.runtime.sendMessage({ ...message, _forwarded: true }).catch(() => {
      // Popup may be closed — that's fine
    });
    return false;
  }

  // ── Offscreen → content script (highlighting) ──
  if (message.target === 'content') {
    log('bg', 'log', 'Forwarding to content:', message.type);
    forwardToContent({ ...message, _forwarded: true });
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
        console.log('[TTS Studio] BG forwarding TTS_GENERATE. model:', model, '| voice:', voice, '| textLen:', article.text!.length);
        ensureOffscreen().then(() => {
          chrome.runtime.sendMessage({
            target: 'offscreen',
            type: MSG.TTS_GENERATE,
            text: article.text,
            model,
            voice,
            speed: Number(speed),
            useGPU
          }).then(() => {
            console.log('[TTS Studio] BG forwarded TTS_GENERATE to offscreen');
          }).catch((e: Error) => {
            log('bg', 'error', 'Failed to forward TTS_GENERATE:', e.message);
          });
        }).catch((e: Error) => {
          log('bg', 'error', 'ensureOffscreen failed for article TTS:', e.message);
        });
      });
    } else {
      console.warn('[TTS Studio] BG received ARTICLE_EXTRACTED but no text');
    }
    return false;
  }
});

log('bg', 'log', 'Background service worker initialized');
