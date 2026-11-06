/**
 * Manages the offscreen document lifecycle.
 * Chrome MV3 service workers cannot run WASM or play audio —
 * the offscreen document gets those privileges.
 */

import { log } from '../shared/logger.js';
import { setModuleStatus, recordError } from '../shared/state-tracker.js';

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen/index.html');

let offscreenReady = false;
const offscreenMessageQueue: Array<Record<string, unknown>> = [];

/**
 * Ensure the offscreen document exists. Creates it if missing.
 */
export async function ensureOffscreen(): Promise<void> {
  const exists = await chrome.offscreen.hasDocument();
  if (exists) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [
      chrome.offscreen.Reason.AUDIO_PLAYBACK,
      chrome.offscreen.Reason.DOM_PARSER
    ],
    justification:
      'ONNX Runtime Web requires a DOM context for WASM; Web Audio API is needed for TTS playback.'
  });
}

/**
 * Close the offscreen document if it exists.
 */
export async function closeOffscreen(): Promise<void> {
  offscreenReady = false;
  offscreenMessageQueue.length = 0;
  const exists = await chrome.offscreen.hasDocument();
  if (exists) {
    await chrome.offscreen.closeDocument();
  }
}

/**
 * Mark offscreen document ready and flush pending message queue.
 */
export function setOffscreenReady(ready: boolean): void {
  offscreenReady = ready;
  if (ready) {
    flushOffscreenQueue();
  }
}

/**
 * Check if the offscreen document has confirmed its ready listener.
 */
export function isOffscreenReady(): boolean {
  return offscreenReady;
}

/**
 * Flush all messages queued while waiting for offscreen document to mount.
 */
export function flushOffscreenQueue(): void {
  while (offscreenMessageQueue.length > 0) {
    const msg = offscreenMessageQueue.shift();
    if (!msg) continue;
    chrome.runtime.sendMessage({
      ...msg,
      _forwarded: true
    }).catch((e: Error) => {
      log('bg', 'error', 'Failed to forward queued message to offscreen:', e.message);
    });
  }
}

/**
 * Send a message safely to the offscreen document.
 * Ensures the offscreen document exists and queues the message until the offscreen
 * document announces ready, preventing "Receiving end does not exist" race conditions.
 */
export function sendToOffscreen(message: Record<string, unknown>): void {
  ensureOffscreen().then(() => {
    setModuleStatus('offscreen', 'active');
    if (offscreenReady) {
      chrome.runtime.sendMessage({ ...message, _forwarded: true }).catch((e: Error) => {
        log('bg', 'error', 'Failed to send to offscreen:', e.message);
        recordError('bg', e.message);
      });
    } else {
      log('bg', 'log', 'Queueing message for offscreen:', message.type);
      offscreenMessageQueue.push(message);
    }
  }).catch((e: Error) => {
    log('bg', 'error', 'ensureOffscreen failed:', e.message);
    recordError('bg', e.message);
    setModuleStatus('offscreen', 'error');
  });
}
