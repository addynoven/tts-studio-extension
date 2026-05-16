import { describe, it, expect, vi } from 'vitest';
import { ensureContentScript } from '../../src/background/content-script-injector.js';
import { setTabsSendMessageResponse, setTabsSendMessageError } from '../setup.js';

describe('content-script-injector', () => {
  it('returns immediately if content script responds to ping', async () => {
    setTabsSendMessageResponse({ ok: true });
    await ensureContentScript(1);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: '__TTS_PING' }),
      expect.any(Function)
    );
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('injects content script when ping fails', async () => {
    let injected = false;
    const originalSendMessage = chrome.tabs.sendMessage;
    chrome.tabs.sendMessage = vi.fn((tabId, message, callback) => {
      if (injected) {
        setTimeout(() => callback({ ok: true }), 10);
        return undefined;
      }
      setTimeout(() => {
        globalThis.chrome.runtime.lastError = { message: 'Receiving end does not exist' };
        callback();
        globalThis.chrome.runtime.lastError = null;
      }, 5);
      return undefined;
    });

    chrome.scripting.executeScript.mockImplementation(async () => {
      injected = true;
      return [];
    });

    await ensureContentScript(1);
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 1 },
        files: ['content.js'],
        injectImmediately: true
      })
    );

    chrome.tabs.sendMessage = originalSendMessage;
  });

  it('throws when tabId is missing', async () => {
    await expect(ensureContentScript(0)).rejects.toThrow('No tabId provided');
  });

  it('throws when injection times out', async () => {
    setTabsSendMessageError('Receiving end does not exist');
    await expect(ensureContentScript(1)).rejects.toThrow('Content script failed to initialize');
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
  });

  it('resolves after injection when ping eventually succeeds', async () => {
    let callCount = 0;
    const originalSendMessage = chrome.tabs.sendMessage;
    chrome.tabs.sendMessage = vi.fn((tabId, message, callback) => {
      callCount++;
      if (callCount <= 2) {
        if (callback) {
          setTimeout(() => {
            globalThis.chrome.runtime.lastError = { message: 'not found' };
            callback();
            globalThis.chrome.runtime.lastError = null;
          }, 5);
        }
        return undefined;
      }
      if (callback) {
        setTimeout(() => callback({ ok: true }), 5);
      }
      return Promise.resolve({ ok: true });
    });

    await ensureContentScript(1);
    expect(chrome.scripting.executeScript).toHaveBeenCalled();

    chrome.tabs.sendMessage = originalSendMessage;
  });
});
