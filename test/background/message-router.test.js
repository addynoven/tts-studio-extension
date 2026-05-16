import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules BEFORE any imports
vi.mock('../../src/background/offscreen-manager.js', () => ({
  ensureOffscreen: vi.fn(async () => {}),
  closeOffscreen: vi.fn(async () => {})
}));

vi.mock('../../src/background/context-menus.js', () => ({
  initContextMenus: vi.fn()
}));

vi.mock('../../src/background/commands.js', () => ({
  initCommands: vi.fn()
}));

vi.mock('../../src/background/state-manager.js', () => ({
  initStateSync: vi.fn()
}));

import { ensureOffscreen } from '../../src/background/offscreen-manager.js';
import { MSG } from '../../src/shared/constants.js';

describe('background message router', () => {
  let messageHandler = null;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear module cache so we get a fresh import each time
    vi.resetModules();
    // Fresh import — module registers its listener on load
    await import('../../src/background/index.js');
    // Extract the handler from the last addListener call
    const calls = chrome.runtime.onMessage.addListener.mock.calls;
    messageHandler = calls[calls.length - 1]?.[0];
  });

  it('has a registered message handler', () => {
    expect(typeof messageHandler).toBe('function');
  });

  it('responds to ENSURE_OFFSCREEN with ok:true', async () => {
    const sendResponse = vi.fn();
    const result = messageHandler({ type: MSG.ENSURE_OFFSCREEN }, {}, sendResponse);
    expect(result).toBe(true); // async response
    expect(ensureOffscreen).toHaveBeenCalled();
    // Wait for promise resolution
    await new Promise(r => setTimeout(r, 10));
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it('forwards offscreen-target messages with _forwarded flag', async () => {
    const msg = { target: 'offscreen', type: MSG.TTS_GENERATE, text: 'hello' };
    messageHandler(msg, {}, vi.fn());
    await new Promise(r => setTimeout(r, 10));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'offscreen', type: MSG.TTS_GENERATE, _forwarded: true })
    );
  });

  it('forwards popup-target messages with _forwarded flag', () => {
    const msg = { target: 'popup', type: MSG.STATUS_DONE };
    messageHandler(msg, {}, vi.fn());
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'popup', type: MSG.STATUS_DONE, _forwarded: true })
    );
  });

  it('does NOT re-forward messages with _forwarded=true', () => {
    chrome.runtime.sendMessage.mockClear();
    const msg = { target: 'popup', type: MSG.STATUS_DONE, _forwarded: true };
    const result = messageHandler(msg, {}, vi.fn());
    expect(result).toBe(false);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('does NOT re-forward offscreen messages with _forwarded=true', () => {
    chrome.runtime.sendMessage.mockClear();
    const msg = { target: 'offscreen', type: MSG.TTS_STOP, _forwarded: true };
    const result = messageHandler(msg, {}, vi.fn());
    expect(result).toBe(false);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('handles ARTICLE_EXTRACTED without forwarding', () => {
    const msg = { type: MSG.ARTICLE_EXTRACTED, article: { title: 'Test' } };
    const result = messageHandler(msg, {}, vi.fn());
    expect(result).toBe(false);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MSG.ARTICLE_EXTRACTED })
    );
  });
});
