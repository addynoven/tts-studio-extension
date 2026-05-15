/**
 * Messaging protocol documentation and helpers.
 * All inter-module communication goes through chrome.runtime.sendMessage().
 */

/**
 * Send a message to a specific target.
 * @param {string} target - 'background' | 'popup' | 'content' | 'offscreen'
 * @param {string} type - Message type constant
 * @param {object} payload - Additional data
 */
export function sendTo(target, type, payload = {}) {
  return chrome.runtime.sendMessage({ target, type, ...payload });
}

/**
 * Send a message to the active tab's content script.
 * @param {string} type - Message type
 * @param {object} payload - Additional data
 */
export async function sendToContent(type, payload = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return chrome.tabs.sendMessage(tab.id, { type, ...payload });
}

/**
 * Create a message listener that filters by target and type.
 * @param {string} myTarget - The target this module listens for
 * @param {function} handler - (message, sender, sendResponse) => void
 * @returns {function} Listener function for chrome.runtime.onMessage.addListener
 */
export function createListener(myTarget, handler) {
  return (message, sender, sendResponse) => {
    if (message.target !== myTarget) return false;
    const result = handler(message, sender, sendResponse);
    // If handler returns a Promise, keep channel open
    if (result && typeof result.then === 'function') {
      result.then(sendResponse).catch(err => sendResponse({ error: err.message }));
      return true;
    }
    return false;
  };
}
