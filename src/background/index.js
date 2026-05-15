/**
 * Background Service Worker — Entry Point
 * Wires together all background modules.
 *
 * NOTE: This is a CENTRAL MESSAGE ROUTER. It must handle ALL messages
 * regardless of target field, because it forwards messages between
 * popup ↔ offscreen ↔ content scripts.
 */

import { MSG } from '../shared/constants.js';
import { ensureOffscreen } from './offscreen-manager.js';
import { initContextMenus } from './context-menus.js';
import { initCommands } from './commands.js';
import { initStateSync } from './state-manager.js';
import { log } from '../shared/logger.js';
import { setModuleStatus, recordError } from '../shared/state-tracker.js';

// ── Initialize modules ─────────────────────────────────────────────────────

initContextMenus();
initCommands();
initStateSync();

// ── Message router ─────────────────────────────────────────────────────────
// The background sees ALL messages and routes them. Do NOT filter by target.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  setModuleStatus('bg', 'active');
  log('bg', 'log', 'Received:', message.type || '(no type)', '| target:', message.target || '(no target)');

  // Popup asks us to create offscreen doc before it sends messages directly
  if (message.type === MSG.ENSURE_OFFSCREEN) {
    ensureOffscreen()
      .then(() => {
        log('bg', 'log', 'Offscreen document ensured');
        setModuleStatus('offscreen', 'active');
        sendResponse({ ok: true });
      })
      .catch((e) => {
        log('bg', 'error', 'ensureOffscreen failed:', e.message);
        recordError('bg', e.message);
        setModuleStatus('offscreen', 'error');
        sendResponse({ ok: false, error: e.message });
      });
    return true; // keep channel open for async response
  }

  // Popup → offscreen (generate / stop)
  if (message.target === 'offscreen') {
    log('bg', 'log', 'Forwarding to offscreen:', message.type);
    ensureOffscreen().then(() => {
      setModuleStatus('offscreen', 'active');
      chrome.runtime.sendMessage(message).catch((e) => {
        log('bg', 'error', 'Failed to forward to offscreen:', e.message);
        recordError('bg', e.message);
        setModuleStatus('offscreen', 'error');
      });
    }).catch((e) => {
      log('bg', 'error', 'ensureOffscreen failed for forward:', e.message);
      recordError('bg', e.message);
      setModuleStatus('offscreen', 'error');
    });
    return false;
  }

  // Offscreen → popup (status updates, errors, progress)
  if (message.target === 'popup') {
    log('bg', 'log', 'Forwarding to popup:', message.type);
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup may be closed — that's fine
    });
    return false;
  }

  // Content script → background
  if (message.type === MSG.ARTICLE_EXTRACTED) {
    log('bg', 'log', 'Article extracted:', message.article?.title);
    return false;
  }
});

log('bg', 'log', 'Background service worker initialized');
