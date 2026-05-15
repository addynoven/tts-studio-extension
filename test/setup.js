/**
 * Vitest setup — global mocks for Chrome extension APIs
 */

import { vi } from 'vitest';

// ── chrome.storage.session ──────────────────────────────────────────────────

const sessionStorage = new Map();

global.chrome = {
  storage: {
    session: {
      get: vi.fn(async (keys) => {
        if (typeof keys === 'string') {
          return { [keys]: sessionStorage.get(keys) };
        }
        if (Array.isArray(keys)) {
          const result = {};
          for (const key of keys) {
            if (sessionStorage.has(key)) result[key] = sessionStorage.get(key);
          }
          return result;
        }
        // keys is an object — return values for its keys
        const result = {};
        for (const key of Object.keys(keys)) {
          if (sessionStorage.has(key)) result[key] = sessionStorage.get(key);
        }
        return result;
      }),
      set: vi.fn(async (items) => {
        for (const [key, value] of Object.entries(items)) {
          sessionStorage.set(key, value);
        }
      }),
      remove: vi.fn(async (keys) => {
        if (typeof keys === 'string') {
          sessionStorage.delete(keys);
        } else if (Array.isArray(keys)) {
          for (const key of keys) sessionStorage.delete(key);
        }
      })
    },
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {})
    }
  },

  runtime: {
    getURL: vi.fn((path) => `chrome-extension://test-id/${path}`),
    sendMessage: vi.fn(async () => {}),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    }
  },

  offscreen: {
    hasDocument: vi.fn(async () => false),
    createDocument: vi.fn(async () => {}),
    Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK', DOM_PARSER: 'DOM_PARSER' }
  },

  tabs: {
    query: vi.fn(async () => [{ id: 1 }]),
    sendMessage: vi.fn(async () => ({}))
  },

  contextMenus: {
    create: vi.fn(),
    removeAll: vi.fn(),
    onClicked: { addListener: vi.fn() }
  },

  commands: {
    onCommand: { addListener: vi.fn() }
  }
};

// Reset session storage before each test
export function resetSessionStorage() {
  sessionStorage.clear();
}

// Helper to peek at stored values
export function getStored(key) {
  return sessionStorage.get(key);
}

// Helper to set stored values directly
export function setStored(key, value) {
  sessionStorage.set(key, value);
}

beforeEach(() => {
  resetSessionStorage();
  vi.clearAllMocks();
});
