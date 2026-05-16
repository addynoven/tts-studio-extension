/**
 * Right-click context menus.
 * Allows users to trigger TTS from any page.
 */

import { MSG } from '../shared/constants.js';
import { ensureOffscreen } from './offscreen-manager.js';
import { getSettings } from '../shared/storage.js';
import { defaultVoiceForModel } from '../shared/constants.js';

/**
 * Create all context menu items on extension install/update.
 */
export function initContextMenus() {
  chrome.runtime.onInstalled.addListener(() => {
    // Remove existing menus to avoid duplicates
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'tts-read-selection',
        title: '🎙️ Read with TTS Studio',
        contexts: ['selection']
      });

      chrome.contextMenus.create({
        id: 'tts-read-article',
        title: '📄 Read this article',
        contexts: ['page']
      });

      // TODO: Phase 2 — Add "Read from here"
      // chrome.contextMenus.create({
      //   id: 'tts-read-from-here',
      //   title: '🔊 Read from here',
      //   contexts: ['all']
      // });
    });
  });

  // Handle menu clicks
  chrome.contextMenus.onClicked.addListener(handleMenuClick);
}

/**
 * Handle context menu item clicks.
 */
async function handleMenuClick(info) {
  console.log('[TTS Studio] Context menu clicked:', info.menuItemId);
  if (!info.menuItemId.startsWith('tts-')) return;

  const settings = await getSettings();
  const model = settings.defaultModel;
  const voice = settings.defaultVoice || defaultVoiceForModel(model);
  const speed = settings.defaultSpeed;

  switch (info.menuItemId) {
    case 'tts-read-selection': {
      if (!info.selectionText) return;
      await ensureOffscreen();
      chrome.runtime.sendMessage({
        target: 'offscreen',
        type: MSG.TTS_GENERATE,
        text: info.selectionText.trim(),
        model,
        voice,
        speed: Number(speed)
      });
      break;
    }

    case 'tts-read-article': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) break;

      // Ensure content script is injected (handles tabs open before extension reload)
      await ensureContentScript(tab.id);

      chrome.tabs.sendMessage(tab.id, { type: MSG.EXTRACT_ARTICLE })
        .catch((e) => console.error('[TTS Studio] EXTRACT_ARTICLE failed:', e.message));
      break;
    }
  }
}

/**
 * Ensure the content script is injected on the given tab.
 * Always injects — Chrome won't double-execute if already loaded
 * because our content script guards against re-init at the top.
 */
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  } catch (e) {
    console.warn('[TTS Studio] Could not inject content script:', e.message);
  }
  // Wait for the script to initialize its message listeners
  await new Promise(r => setTimeout(r, 200));
}

