import { describe, it, expect, vi } from 'vitest';
import { getExtensionUrl } from '../../src/shared/extension-url.js';

describe('extension-url', () => {
  it('uses chrome.runtime.getURL when available', () => {
    vi.mocked(chrome.runtime.getURL).mockReturnValue('chrome-extension://abc/assets/test.js');
    expect(getExtensionUrl('assets/test.js')).toBe('chrome-extension://abc/assets/test.js');
  });

  it('falls back to worker URL derivation when chrome.runtime is unavailable', () => {
    const originalChrome = globalThis.chrome;
    globalThis.chrome = undefined;

    const originalLocation = self.location.href;
    Object.defineProperty(self, 'location', {
      value: { href: 'chrome-extension://abc/tts-worker/tts-worker.js' },
      writable: true,
      configurable: true
    });

    expect(getExtensionUrl('assets/test.js')).toBe('chrome-extension://abc/assets/test.js');

    globalThis.chrome = originalChrome;
    Object.defineProperty(self, 'location', {
      value: { href: originalLocation },
      writable: true,
      configurable: true
    });
  });
});
