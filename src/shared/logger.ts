/**
 * Centralized debug logging.
 * All modules use this instead of console.log() directly.
 * Logs go to BOTH console (always) AND the popup debug panel (when enabled).
 */

const MAX_LOGS = 200;
const STORAGE_KEY = 'tts_debug_logs';

export type LogSource = 'bg' | 'content' | 'offscreen' | 'popup';
export type LogLevel = 'log' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  source: LogSource;
  level: LogLevel;
  message: string;
}

/**
 * Log a message. Always goes to console. Also goes to popup if debug mode on.
 */
export function log(source: LogSource, level: LogLevel, ...args: unknown[]): void {
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  });

  const message = args.map(a => {
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');

  // Always log to console
  const prefix = `[${timestamp}] [${source}]`;
  if (level === 'error') console.error(prefix, ...args);
  else if (level === 'warn') console.warn(prefix, ...args);
  else console.log(prefix, ...args);

  // Store in session storage (so popup can read when reopened)
  storeLog({ timestamp, source, level, message });

  // Send to popup debug panel
  try {
    chrome.runtime.sendMessage({
      target: 'popup',
      type: 'DEBUG_LOG',
      entry: { timestamp, source, level, message }
    }).catch(() => {});
  } catch {
    // Popup may be closed — that's fine
  }
}

// Serialize storage writes to prevent race conditions when multiple
// log() calls happen in rapid succession.
let storeQueue = Promise.resolve();

async function storeLog(entry: LogEntry) {
  storeQueue = storeQueue.then(async () => {
    try {
      const { [STORAGE_KEY]: existing } = await chrome.storage.session.get(STORAGE_KEY);
      const logs: LogEntry[] = (existing as LogEntry[] | undefined) || [];
      logs.push(entry);
      if (logs.length > MAX_LOGS) logs.shift();
      await chrome.storage.session.set({ [STORAGE_KEY]: logs });
    } catch {
      // Storage may not be available
    }
  });
  return storeQueue;
}

/**
 * Clear all debug logs.
 */
export async function clearDebugLogs(): Promise<void> {
  try {
    await chrome.storage.session.remove(STORAGE_KEY);
  } catch {
    // Storage may not be available
  }
}
