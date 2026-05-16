import { describe, it, expect, vi } from 'vitest';
import { MSG } from '../../src/shared/constants.js';

vi.mock('../../src/background/offscreen-manager.js', () => ({
  ensureOffscreen: vi.fn(async () => {})
}));

vi.mock('../../src/background/content-script-injector.js', () => ({
  ensureContentScript: vi.fn(async () => {})
}));

describe('context-menus', () => {
  let installedHandler;
  let clickHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { initContextMenus } = await import('../../src/background/context-menus.js');
    initContextMenus();

    const installedCalls = chrome.runtime.onInstalled.addListener.mock.calls;
    installedHandler = installedCalls[installedCalls.length - 1]?.[0];

    const clickCalls = chrome.contextMenus.onClicked.addListener.mock.calls;
    clickHandler = clickCalls[clickCalls.length - 1]?.[0];
  });

  it('registers onInstalled listener', () => {
    expect(typeof installedHandler).toBe('function');
  });

  it('registers context menu click listener', () => {
    expect(typeof clickHandler).toBe('function');
  });

  it('creates menu items on install', () => {
    installedHandler();
    expect(chrome.contextMenus.removeAll).toHaveBeenCalled();
    expect(chrome.contextMenus.create).toHaveBeenCalledTimes(2);
    expect(chrome.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tts-read-selection', contexts: ['selection'] })
    );
    expect(chrome.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tts-read-article', contexts: ['page'] })
    );
  });

  it('ignores non-tts menu clicks', async () => {
    await clickHandler({ menuItemId: 'some-other-item' });
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('handles read-selection with text', async () => {
    await clickHandler({ menuItemId: 'tts-read-selection', selectionText: 'Hello world' });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'offscreen',
        type: MSG.TTS_GENERATE,
        text: 'Hello world'
      })
    );
  });

  it('ignores read-selection without text', async () => {
    await clickHandler({ menuItemId: 'tts-read-selection', selectionText: '' });
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('handles read-article by sending EXTRACT_ARTICLE to tab', async () => {
    await clickHandler({ menuItemId: 'tts-read-article' });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: MSG.EXTRACT_ARTICLE })
    );
  });
});
