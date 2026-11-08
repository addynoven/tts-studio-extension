/**
 * Right-click context menus.
 * Allows users to trigger TTS from any page.
 */

import { MSG } from '../shared/constants.js';
import { sendToOffscreen } from './offscreen-manager.js';
import { speakNative, stopNative } from './native-tts.js';
import { getSettings } from '../shared/storage.js';
import { defaultVoiceForModel } from '../shared/constants.js';
import { ensureContentScript } from './content-script-injector.js';
import { isPdfUrl, isRestrictedUrl } from '../shared/extension-url.js';

/**
 * Register all context menu items.
 * Called on install, update, and service worker startup to guarantee menu existence.
 */
export function setupContextMenus(): void {
  if (typeof chrome === 'undefined' || !chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'tts-read-selection',
      title: '🎙️ Read with TTS Studio',
      contexts: ['selection']
    }, () => {
      if (chrome.runtime.lastError) {
        // Ignore duplicate error if already registered
      }
    });

    chrome.contextMenus.create({
      id: 'tts-read-article',
      title: '📄 Read this article',
      contexts: ['page']
    }, () => {
      if (chrome.runtime.lastError) {
        // Ignore
      }
    });
  });
}

/**
 * Create all context menu items and attach click handlers.
 */
export function initContextMenus(): void {
  chrome.runtime.onInstalled.addListener(() => {
    setupContextMenus();
  });

  // Ensure menus are created on worker init/wake
  setupContextMenus();

  chrome.contextMenus.onClicked.addListener(handleMenuClick);
}

/**
 * Handle context menu item clicks.
 */
async function handleMenuClick(info: chrome.contextMenus.OnClickData): Promise<void> {
  console.log('[TTS Studio] Context menu clicked:', info.menuItemId);
  if (!info.menuItemId?.toString().startsWith('tts-')) return;

  const settings = await getSettings();
  const model = settings.defaultModel;
  const voice = settings.defaultVoice || defaultVoiceForModel(model);
  const speed = settings.defaultSpeed;
  const useGPU = settings.executionProvider === 'webgpu';

  switch (info.menuItemId) {
    case 'tts-read-selection': {
      const selectedText = info.selectionText?.trim();
      if (!selectedText) return;

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const isPdf = isPdfUrl(tab?.url);
      const isRestricted = isRestrictedUrl(tab?.url);

      // On non-restricted regular web pages, attempt in-page streaming with visual paragraph/word highlights
      if (tab?.id && !isPdf && !isRestricted) {
        try {
          await ensureContentScript(tab.id, tab.url);
          chrome.tabs.sendMessage(tab.id, { type: MSG.STATUS_PLAYING, _forwarded: true }).catch(() => {});
          const res = await chrome.tabs.sendMessage(tab.id, {
            type: MSG.STREAM_START,
            fromSelection: true,
            text: selectedText
          });
          if (res?.ok) break;
        } catch (e) {
          console.warn('[TTS Studio] In-page selection stream failed, falling back to background TTS:', e);
        }
      }

      // PDF / Direct Selection Fallback: Speak text directly via Kokoro (offscreen) or Native TTS
      const targetModel = model === 'native' ? 'native' : 'kokoro';
      if (targetModel === 'native') {
        stopNative();
        speakNative(selectedText, {
          voice: voice !== 'default' ? voice : undefined,
          speed: Number(speed),
          onStart: () => {
            chrome.runtime.sendMessage({ target: 'popup', type: MSG.STATUS_PLAYING, _forwarded: true }).catch(() => {});
            if (tab?.id && !isPdf && !isRestricted) {
              chrome.tabs.sendMessage(tab.id, { type: MSG.STATUS_PLAYING, _forwarded: true }).catch(() => {});
            }
          },
          onWord: (charIndex, charLength) => {
            if (tab?.id && !isPdf && !isRestricted) {
              chrome.tabs.sendMessage(tab.id, { type: MSG.HIGHLIGHT_WORD, charIndex, charLength, _forwarded: true }).catch(() => {});
            }
          },
          onEnd: () => {
            chrome.runtime.sendMessage({ target: 'popup', type: MSG.STATUS_DONE, _forwarded: true }).catch(() => {});
            if (tab?.id && !isPdf && !isRestricted) {
              chrome.tabs.sendMessage(tab.id, { type: MSG.STATUS_DONE, _forwarded: true }).catch(() => {});
            }
          },
          onError: (err) => {
            chrome.runtime.sendMessage({ target: 'popup', type: MSG.STATUS_ERROR, error: err, _forwarded: true }).catch(() => {});
          }
        });
      } else {
        sendToOffscreen({
          target: 'offscreen',
          type: MSG.TTS_GENERATE,
          text: selectedText,
          model: targetModel,
          voice,
          speed: Number(speed),
          useGPU
        });
      }
      break;
    }

    case 'tts-read-article': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) break;

      if (isPdfUrl(tab.url)) {
        console.warn('[TTS Studio] Cannot extract article from PDF page; select text to read.');
        break;
      }

      try {
        await ensureContentScript(tab.id, tab.url);
        chrome.tabs.sendMessage(tab.id, { type: MSG.STATUS_PLAYING, _forwarded: true }).catch(() => {});
        chrome.tabs.sendMessage(tab.id, { type: MSG.STREAM_START })
          .catch((e: Error) => console.error('[TTS Studio] STREAM_START failed:', e.message));
      } catch (err) {
        console.warn('[TTS Studio] Content script injection failed for article read:', err);
      }
      break;
    }
  }
}
