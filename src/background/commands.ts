/**
 * Keyboard shortcuts (Chrome commands API).
 * Defined in manifest.json under the "commands" section.
 *
 * Current shortcuts:
 *   Alt+Shift+R  → Read current article
 *   Alt+Shift+S  → Play/Pause
 *   Alt+Shift+N  → Next sentence
 *   Alt+Shift+P  → Previous sentence
 *   Alt+Shift+V  → Open popup
 */

import { MSG } from '../shared/constants.js';
import { ensureOffscreen } from './offscreen-manager.js';
import { ensureContentScript } from './content-script-injector.js';

/**
 * Initialize keyboard shortcut listeners.
 */
export function initCommands(): void {
  chrome.commands.onCommand.addListener(async (command: string) => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;

    switch (command) {
      case 'read-article':
        if (tabId) {
          await ensureContentScript(tabId);
          chrome.tabs.sendMessage(tabId, { type: MSG.EXTRACT_ARTICLE }).catch(() => {});
        }
        showToast(tabId, '🔊 Reading article...');
        break;

      case 'toggle-playback':
        if (tabId) {
          chrome.tabs.sendMessage(tabId, { type: MSG.TTS_STOP }).catch(() => {});
        }
        break;

      case 'skip-forward':
        await ensureOffscreen();
        chrome.runtime.sendMessage({ target: 'offscreen', type: MSG.TTS_SKIP_FORWARD });
        break;

      case 'skip-backward':
        await ensureOffscreen();
        chrome.runtime.sendMessage({ target: 'offscreen', type: MSG.TTS_SKIP_BACKWARD });
        break;
    }
  });
}

/**
 * Show a toast notification on the page.
 */
function showToast(tabId: number | undefined, message: string): void {
  if (!tabId) return;
  chrome.scripting.executeScript({
    target: { tabId },
    func: (msg: string) => {
      const existing = document.getElementById('tts-studio-toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.id = 'tts-studio-toast';
      toast.textContent = msg;
      toast.style.cssText = `
        position: fixed; top: 20px; right: 20px;
        background: #1a1a2e; color: #e2e2f0; padding: 12px 20px;
        border-radius: 8px; z-index: 2147483647;
        font-family: system-ui; font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: ttsToastIn 0.3s ease;
      `;

      const style = document.createElement('style');
      style.textContent = `
        @keyframes ttsToastIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `;
      document.head.appendChild(style);
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    },
    args: [message]
  });
}
