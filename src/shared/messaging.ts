/**
 * Messaging protocol documentation and helpers.
 * All inter-module communication goes through chrome.runtime.sendMessage().
 */

export type MessageTarget = 'background' | 'popup' | 'content' | 'offscreen';

export interface MessagePayload {
  target?: MessageTarget;
  type: string;
  [key: string]: unknown;
}

export type MessageHandler = (
  message: MessagePayload,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => unknown;

/**
 * Send a message to a specific target.
 */
export function sendTo(
  target: MessageTarget,
  type: string,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  return chrome.runtime.sendMessage({ target, type, ...payload });
}

/**
 * Send a message to the active tab's content script.
 */
export async function sendToContent(
  type: string,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return chrome.tabs.sendMessage(tab.id, { type, ...payload });
}

/**
 * Create a message listener that filters by target and type.
 */
export function createListener(myTarget: MessageTarget, handler: MessageHandler) {
  return (message: MessagePayload, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
    if (message.target !== myTarget) return false;
    const result = handler(message, sender, sendResponse);
    // If handler returns a Promise, keep channel open
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>)
        .then(sendResponse)
        .catch(err => sendResponse({ error: (err as Error).message }));
      return true;
    }
    return false;
  };
}
