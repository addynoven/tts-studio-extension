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

/**
 * Create all context menu items on extension install/update.
 */
export function initContextMenus(): void {
  chrome.runtime.onInstalled.addListener(() => {
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
    });
  });

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
      if (!info.selectionText) return;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await ensureContentScript(tab.id);
      }
      const targetModel = model === 'native' ? 'native' : 'kokoro';
      if (targetModel === 'native') {
        stopNative();
        speakNative(info.selectionText.trim(), {
          voice: voice !== 'default' ? voice : undefined,
          speed: Number(speed),
          onStart: () => {
            chrome.runtime.sendMessage({ target: 'popup', type: MSG.STATUS_PLAYING, _forwarded: true }).catch(() => {});
            if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: MSG.STATUS_PLAYING, _forwarded: true }).catch(() => {});
          },
          onWord: (charIndex, charLength) => {
            if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: MSG.HIGHLIGHT_WORD, charIndex, charLength, _forwarded: true }).catch(() => {});
          },
          onEnd: () => {
            chrome.runtime.sendMessage({ target: 'popup', type: MSG.STATUS_DONE, _forwarded: true }).catch(() => {});
            if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: MSG.STATUS_DONE, _forwarded: true }).catch(() => {});
          },
          onError: (err) => {
            chrome.runtime.sendMessage({ target: 'popup', type: MSG.STATUS_ERROR, error: err, _forwarded: true }).catch(() => {});
          }
        });
      } else {
        sendToOffscreen({
          target: 'offscreen',
          type: MSG.TTS_GENERATE,
          text: info.selectionText.trim(),
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

      await ensureContentScript(tab.id);

      chrome.tabs.sendMessage(tab.id, { type: MSG.STREAM_START })
        .catch((e: Error) => console.error('[TTS Studio] STREAM_START failed:', e.message));
      break;
    }
  }
}
