import { describe, it, expect, vi } from 'vitest';
import { MSG } from '../../src/shared/constants.js';

vi.mock('../../src/background/offscreen-manager.js', () => ({
  ensureOffscreen: vi.fn(async () => {})
}));

vi.mock('../../src/background/content-script-injector.js', () => ({
  ensureContentScript: vi.fn(async () => {})
}));

import { ensureContentScript } from '../../src/background/content-script-injector.js';

describe('commands', () => {
  let commandHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { initCommands } = await import('../../src/background/commands.js');
    initCommands();
    const calls = chrome.commands.onCommand.addListener.mock.calls;
    commandHandler = calls[calls.length - 1]?.[0];
  });

  it('registers command listener', () => {
    expect(typeof commandHandler).toBe('function');
  });

  it('read-article sends EXTRACT_ARTICLE to active tab', async () => {
    await commandHandler('read-article');
    expect(ensureContentScript).toHaveBeenCalledWith(1);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: MSG.EXTRACT_ARTICLE })
    );
  });

  it('toggle-playback sends TTS_STOP to active tab', async () => {
    await commandHandler('toggle-playback');
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: MSG.TTS_STOP })
    );
  });

  it('skip-forward sends TTS_SKIP_FORWARD to offscreen', async () => {
    await commandHandler('skip-forward');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'offscreen', type: MSG.TTS_SKIP_FORWARD })
    );
  });

  it('skip-backward sends TTS_SKIP_BACKWARD to offscreen', async () => {
    await commandHandler('skip-backward');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'offscreen', type: MSG.TTS_SKIP_BACKWARD })
    );
  });

  it('shows toast on read-article command', async () => {
    await commandHandler('read-article');
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 1 },
        func: expect.any(Function)
      })
    );
  });
});
