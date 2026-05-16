/**
 * Vitest setup — global mocks for Chrome extension APIs
 */

import { vi } from 'vitest';
import 'fake-indexeddb/auto';

// ── Storage backends ────────────────────────────────────────────────────────

const localStorage = new Map<string, unknown>();
const sessionStorage = new Map<string, unknown>();

// ── Mock state helpers ──────────────────────────────────────────────────────

let tabsSendMessageResponse: unknown = {};
let tabsSendMessageError: string | null = null;
let offscreenHasDocument = false;

function createTabsSendMessageMock() {
  return vi.fn((tabId: number, message: unknown, optionsOrCallback?: unknown, maybeCallback?: unknown) => {
    const callback =
      typeof optionsOrCallback === 'function'
        ? (optionsOrCallback as (r?: unknown) => void)
        : typeof maybeCallback === 'function'
          ? (maybeCallback as (r?: unknown) => void)
          : null;

    if (callback) {
      if (tabsSendMessageError) {
        (globalThis as any).chrome.runtime.lastError = { message: tabsSendMessageError };
        callback();
        (globalThis as any).chrome.runtime.lastError = null;
      } else {
        callback(tabsSendMessageResponse);
      }
      return undefined;
    }

    if (tabsSendMessageError) {
      return Promise.reject(new Error(tabsSendMessageError));
    }
    return Promise.resolve(tabsSendMessageResponse);
  });
}

// ── Global chrome mock ──────────────────────────────────────────────────────

(globalThis as any).chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[] | Record<string, unknown>) => {
        if (typeof keys === 'string') {
          return { [keys]: localStorage.get(keys) };
        }
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          for (const key of keys) {
            if (localStorage.has(key)) result[key] = localStorage.get(key);
          }
          return result;
        }
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(keys)) {
          if (localStorage.has(key)) result[key] = localStorage.get(key);
        }
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) {
          localStorage.set(key, value);
        }
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        if (typeof keys === 'string') {
          localStorage.delete(keys);
        } else if (Array.isArray(keys)) {
          for (const key of keys) localStorage.delete(key);
        }
      })
    },
    session: {
      get: vi.fn(async (keys: string | string[] | Record<string, unknown>) => {
        if (typeof keys === 'string') {
          return { [keys]: sessionStorage.get(keys) };
        }
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          for (const key of keys) {
            if (sessionStorage.has(key)) result[key] = sessionStorage.get(key);
          }
          return result;
        }
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(keys)) {
          if (sessionStorage.has(key)) result[key] = sessionStorage.get(key);
        }
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) {
          sessionStorage.set(key, value);
        }
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        if (typeof keys === 'string') {
          sessionStorage.delete(keys);
        } else if (Array.isArray(keys)) {
          for (const key of keys) sessionStorage.delete(key);
        }
      })
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    }
  },

  runtime: {
    getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
    sendMessage: vi.fn(async () => {}),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    },
    onInstalled: {
      addListener: vi.fn()
    },
    lastError: null
  },

  offscreen: {
    hasDocument: vi.fn(async () => offscreenHasDocument),
    createDocument: vi.fn(async () => { offscreenHasDocument = true; }),
    closeDocument: vi.fn(async () => { offscreenHasDocument = false; }),
    Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK', DOM_PARSER: 'DOM_PARSER' }
  },

  tabs: {
    query: vi.fn(async () => [{ id: 1 }]),
    sendMessage: createTabsSendMessageMock()
  },

  scripting: {
    executeScript: vi.fn(async () => [])
  },

  contextMenus: {
    create: vi.fn(),
    removeAll: vi.fn((callback?: () => void) => { if (callback) callback(); }),
    onClicked: { addListener: vi.fn() }
  },

  commands: {
    onCommand: { addListener: vi.fn() }
  }
};

// ── Helpers exported for tests ──────────────────────────────────────────────

export function resetSessionStorage(): void {
  sessionStorage.clear();
}

export function resetLocalStorage(): void {
  localStorage.clear();
}

export function getStored(key: string): unknown {
  return sessionStorage.get(key);
}

export function setStored(key: string, value: unknown): void {
  sessionStorage.set(key, value);
}

export function getLocalStored(key: string): unknown {
  return localStorage.get(key);
}

export function setLocalStored(key: string, value: unknown): void {
  localStorage.set(key, value);
}

export function setTabsSendMessageResponse(response: unknown): void {
  tabsSendMessageResponse = response;
  tabsSendMessageError = null;
}

export function setTabsSendMessageError(error: string | null): void {
  tabsSendMessageError = error;
}

export function setOffscreenHasDocument(has: boolean): void {
  offscreenHasDocument = has;
}

// ── beforeEach ──────────────────────────────────────────────────────────────

beforeEach(() => {
  resetSessionStorage();
  resetLocalStorage();
  setTabsSendMessageResponse({});
  setTabsSendMessageError(null);
  setOffscreenHasDocument(false);
  vi.clearAllMocks();
});
