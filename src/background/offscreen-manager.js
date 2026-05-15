/**
 * Manages the offscreen document lifecycle.
 * Chrome MV3 service workers cannot run WASM or play audio —
 * the offscreen document gets those privileges.
 */

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen/index.html');

/**
 * Ensure the offscreen document exists. Creates it if missing.
 * @returns {Promise<void>}
 */
export async function ensureOffscreen() {
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
 * @returns {Promise<void>}
 */
export async function closeOffscreen() {
  const exists = await chrome.offscreen.hasDocument();
  if (exists) {
    await chrome.offscreen.closeDocument();
  }
}
