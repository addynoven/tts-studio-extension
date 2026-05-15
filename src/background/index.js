/**
 * Background Service Worker — Entry Point
 * Wires together all background modules.
 */

import { MSG } from '../shared/constants.js';
import { ensureOffscreen } from './offscreen-manager.js';
import { initContextMenus } from './context-menus.js';
import { initCommands } from './commands.js';
import { initStateSync } from './state-manager.js';
import { createListener } from '../shared/messaging.js';
import { log } from '../shared/logger.js';

// ── Initialize modules ─────────────────────────────────────────────────────

initContextMenus();
initCommands();
initStateSync();

// ── Message router ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  createListener('background', async (message, _sender, sendResponse) => {
    switch (message.type) {
      case MSG.ENSURE_OFFSCREEN:
        try {
          await ensureOffscreen();
          sendResponse({ ok: true });
        } catch (e) {
          log('bg', 'error', 'ensureOffscreen failed:', e.message);
          sendResponse({ ok: false, error: e.message });
        }
        return true; // async

      default:
        // Forward messages targeting offscreen or popup
        if (message.target === 'offscreen') {
          ensureOffscreen().then(() => {
            chrome.runtime.sendMessage(message).catch(() => {});
          });
        }
        if (message.target === 'popup') {
          chrome.runtime.sendMessage(message).catch(() => {});
        }
        return false;
    }
  })
);

log('bg', 'log', 'Background service worker initialized');
