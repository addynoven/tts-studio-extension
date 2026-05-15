import { describe, it, expect, vi } from 'vitest';
import { log, clearDebugLogs } from '../../src/shared/logger.js';
import { getStored } from '../setup.js';

const STORAGE_KEY = 'tts_debug_logs';

// log() calls storeLog() async but doesn't await it.
// We need to give the microtask queue a chance to drain.
async function flushLogs() {
  await new Promise(r => setTimeout(r, 10));
}

describe('logger', () => {
  it('formats timestamp, source, and level', async () => {
    log('offscreen', 'log', 'test message');
    await flushLogs();
    const stored = getStored(STORAGE_KEY);
    expect(stored).toHaveLength(1);
    expect(stored[0].source).toBe('offscreen');
    expect(stored[0].level).toBe('log');
    expect(stored[0].message).toBe('test message');
    expect(stored[0].timestamp).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
  });

  it('serializes objects in message', async () => {
    log('popup', 'log', { model: 'piper' });
    await flushLogs();
    const stored = getStored(STORAGE_KEY);
    expect(stored[0].message).toBe('{"model":"piper"}');
  });

  it('stores multiple logs up to max', async () => {
    for (let i = 0; i < 5; i++) {
      log('bg', 'log', `msg ${i}`);
    }
    await flushLogs();
    const stored = getStored(STORAGE_KEY);
    expect(stored).toHaveLength(5);
    expect(stored[4].message).toBe('msg 4');
  });

  it('sends DEBUG_LOG message to popup', async () => {
    log('offscreen', 'warn', 'careful');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'popup',
        type: 'DEBUG_LOG',
        entry: expect.objectContaining({
          source: 'offscreen',
          level: 'warn',
          message: 'careful'
        })
      })
    );
  });

  it('does not throw when sendMessage fails', async () => {
    chrome.runtime.sendMessage.mockRejectedValueOnce(new Error('popup closed'));
    expect(() => log('bg', 'log', 'test')).not.toThrow();
  });

  it('rotates old logs when exceeding max', async () => {
    for (let i = 0; i < 250; i++) {
      log('bg', 'log', `msg ${i}`);
    }
    await flushLogs();
    const stored = getStored(STORAGE_KEY);
    expect(stored.length).toBeLessThanOrEqual(200);
  });

  it('clearDebugLogs removes storage key', async () => {
    log('bg', 'log', 'test');
    await flushLogs();
    expect(getStored(STORAGE_KEY)).toHaveLength(1);
    await clearDebugLogs();
    expect(getStored(STORAGE_KEY)).toBeUndefined();
  });
});
