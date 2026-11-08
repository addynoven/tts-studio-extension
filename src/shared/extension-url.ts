/**
 * Get an extension URL that works in both main thread and Web Worker contexts.
 * Web Workers don't have access to `chrome.runtime`, so we derive the base URL
 * from the script's own location.
 */
export function getExtensionUrl(path: string): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  // Worker fallback: derive extension root from worker script location
  // Worker is at chrome-extension://<id>/tts-worker/tts-worker.js
  // Extension root is two path segments up
  const workerUrl = new URL(self.location.href);
  workerUrl.pathname = workerUrl.pathname.replace(/\/[^/]+\/[^/]+$/, '/') + path;
  return workerUrl.href;
}

/**
 * Detect whether a given URL points to a PDF document or is rendered in Chrome's PDF viewer.
 */
export function isPdfUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return url.toLowerCase().includes('.pdf');
  }
}

/**
 * Detect whether a URL is restricted from extension script injection.
 */
export function isRestrictedUrl(url?: string): boolean {
  if (!url) return false;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('devtools://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('view-source:') ||
    isPdfUrl(url)
  );
}
