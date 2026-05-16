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
  console.log(`[TTS Studio DEBUG] PING tab ${tabId}…`);
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: '__TTS_PING' }, (response) => {
      if (chrome.runtime.lastError) {
        console.log(`[TTS Studio DEBUG] PING tab ${tabId} FAILED:`, chrome.runtime.lastError.message);
        resolve(false);
      } else {
        console.log(`[TTS Studio DEBUG] PING tab ${tabId} SUCCESS:`, response);
        resolve(!!response);
      }
    });
  });
}

/**
 * Inject the content script into a tab.
 *
 * content.js is built as an IIFE (no import/export statements), so it works
 * reliably whether Chrome injects it as a classic script or a module.
 */
async function injectContentScript(tabId: number): Promise<void> {
  console.log(`[TTS Studio DEBUG] INJECTING content.js into tab ${tabId}…`);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
      injectImmediately: true
    });
    console.log(`[TTS Studio DEBUG] INJECTION into tab ${tabId} reported SUCCESS by Chrome`);
  } catch (e: any) {
    console.error(`[TTS Studio DEBUG] INJECTION into tab ${tabId} THREW:`, e.message);
    throw e;
  }
}

/**
 * Ensure the content script is ready in the given tab.
 * If not present, injects it and waits for initialization.
 */
export async function ensureContentScript(tabId: number): Promise<void> {
  if (!tabId) throw new Error('No tabId provided');
  console.log(`[TTS Studio DEBUG] ensureContentScript START for tab ${tabId}`);

  const isAlive = await pingContentScript(tabId);
  if (isAlive) {
    console.log(`[TTS Studio DEBUG] ensureContentScript: already alive, done.`);
    return;
  }

  // Content script is missing or orphaned — inject it
  await injectContentScript(tabId);
  console.log(`[TTS Studio DEBUG] Post-injection delay ${POST_INJECTION_DELAY_MS}ms…`);
  await new Promise((r) => setTimeout(r, POST_INJECTION_DELAY_MS));

  // Wait for the script to initialize and register its listener
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < INJECTION_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 100));
    attempt++;
    console.log(`[TTS Studio DEBUG] Post-injection ping attempt ${attempt}…`);
    const nowAlive = await pingContentScript(tabId);
    if (nowAlive) {
      console.log(`[TTS Studio DEBUG] ensureContentScript: alive after injection, done.`);
      return;
    }
  }

  console.error(`[TTS Studio DEBUG] ensureContentScript: GAVE UP after ${Date.now() - start}ms`);
  throw new Error('Content script failed to initialize after injection');
}
