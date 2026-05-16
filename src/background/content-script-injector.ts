/**
 * Ensures the content script is injected and ready in a given tab.
 *
 * Chrome MV3 content scripts are auto-injected on page load, but after
 * extension reload or service worker restart, existing tabs have orphaned
 * content scripts that can't receive messages. We must re-inject manually.
 */

const CONTENT_SCRIPT_FILE = 'content.js';
const INJECTION_TIMEOUT_MS = 3000;
const POST_INJECTION_DELAY_MS = 300;

/**
 * Ping the content script to see if it's alive.
 */
function pingContentScript(tabId: number): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: '__TTS_PING' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(false);
      } else {
        resolve(!!response);
      }
    });
  });
}

/**
 * Inject the content script into a tab.
 */
async function injectContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_FILE],
    injectImmediately: true
  });
}

/**
 * Ensure the content script is ready in the given tab.
 * If not present, injects it and waits for initialization.
 */
export async function ensureContentScript(tabId: number): Promise<void> {
  if (!tabId) throw new Error('No tabId provided');

  const isAlive = await pingContentScript(tabId);
  if (isAlive) return;

  // Content script is missing or orphaned — inject it
  await injectContentScript(tabId);

  // Wait for the script to initialize and register its listener
  const start = Date.now();
  while (Date.now() - start < INJECTION_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 100));
    const nowAlive = await pingContentScript(tabId);
    if (nowAlive) return;
  }

  throw new Error('Content script failed to initialize after injection');
}
