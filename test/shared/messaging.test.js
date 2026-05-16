import { describe, it, expect, vi } from 'vitest';
import { sendTo, sendToContent, createListener } from '../../src/shared/messaging.js';

describe('messaging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendTo', () => {
    it('sends message with target and type', async () => {
      await sendTo('offscreen', 'TEST_TYPE', { foo: 'bar' });
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        target: 'offscreen',
        type: 'TEST_TYPE',
        foo: 'bar'
      });
    });

    it('sends message without extra payload', async () => {
      await sendTo('popup', 'PING');
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        target: 'popup',
        type: 'PING'
      });
    });
  });

  describe('sendToContent', () => {
    it('queries active tab and sends message', async () => {
      await sendToContent('HIGHLIGHT_CHUNK', { text: 'hello' });
      expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'HIGHLIGHT_CHUNK', text: 'hello' });
    });

    it('throws when no active tab', async () => {
      chrome.tabs.query.mockResolvedValueOnce([]);
      await expect(sendToContent('TEST')).rejects.toThrow('No active tab');
    });
  });

  describe('createListener', () => {
    it('calls handler when target matches', () => {
      const handler = vi.fn(() => 'response');
      const listener = createListener('offscreen', handler);
      const sendResponse = vi.fn();

      const result = listener({ target: 'offscreen', type: 'TEST' }, {}, sendResponse);

      expect(handler).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('ignores messages with different target', () => {
      const handler = vi.fn();
      const listener = createListener('offscreen', handler);

      const result = listener({ target: 'popup', type: 'TEST' }, {}, vi.fn());

      expect(handler).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('returns true and calls sendResponse for async handlers', async () => {
      const handler = vi.fn(async () => 'async-response');
      const listener = createListener('offscreen', handler);
      const sendResponse = vi.fn();

      const result = listener({ target: 'offscreen', type: 'TEST' }, {}, sendResponse);

      expect(result).toBe(true);
      await new Promise(r => setTimeout(r, 10));
      expect(sendResponse).toHaveBeenCalledWith('async-response');
    });

    it('catches async handler errors and sends error response', async () => {
      const handler = vi.fn(async () => { throw new Error('boom'); });
      const listener = createListener('offscreen', handler);
      const sendResponse = vi.fn();

      listener({ target: 'offscreen', type: 'TEST' }, {}, sendResponse);
      await new Promise(r => setTimeout(r, 10));
      expect(sendResponse).toHaveBeenCalledWith({ error: 'boom' });
    });
  });
});
