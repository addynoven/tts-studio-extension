# TTS Studio Extension — Agent Guide

> Browser TTS with KittenTTS, Kokoro & Piper — 100% local, no server.
> This is a Chrome Extension (Manifest V3) that performs text-to-speech entirely
> in the browser using ONNX models and the Web Audio API.

---

## Project Overview

TTS Studio Extension is a feature-based, modular Chrome MV3 extension. It extracts
article text from web pages, sanitizes it, and synthesizes speech using local ONNX
models (KittenTTS, Piper). All processing happens client-side; there is no backend
server.

Key capabilities:
- **Article extraction** via `@mozilla/readability` with DOM block mapping for accurate highlighting.
- **Text sanitization** to strip URLs, code blocks, markdown, and emojis.
- **Sentence highlighting** synchronized with audio playback.
- **Multiple TTS engines** selectable from the popup UI.
- **Keyboard shortcuts** (Alt+Shift+R to read article, Alt+Shift+S to toggle playback, etc.).

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Language | Vanilla JavaScript (ES modules) |
| Build Tool | Vite 6 |
| Test Runner | Vitest 3 (jsdom environment) |
| Linter | ESLint 9 |
| Chrome APIs | Manifest V3 (service worker, offscreen document, content scripts) |
| ML Runtime | ONNX Runtime Web (`ort.min.mjs`) |
| Audio | Web Audio API + custom gapless scheduler |
| DOM Parsing | `@mozilla/readability` |

---

## Build and Test Commands

```bash
# Install dependencies
npm install

# Development (watch mode, rebuilds on change)
npm run dev

# Production build → dist/
npm run build

# Run tests once
npm run test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint
```

### Loading in Chrome

1. Run `npm run build`
2. Open `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the `dist/` folder

---

## Architecture

The project uses a **feature-based modular architecture**. Each feature is self-contained
in its own folder with its own code, styles, and tests. Cross-cutting code lives in
`shared/` only.

```
src/
├── manifest.json          # Chrome manifest (copied to dist/ by build)
├── background/            # Service Worker (MV3)
│   ├── index.js           # Entry point — central message router
│   ├── offscreen-manager.js
│   ├── context-menus.js
│   ├── commands.js        # Keyboard shortcuts
│   └── state-manager.js
├── content/               # Content Script (runs on every page)
│   ├── index.js           # Entry point — message router
│   ├── extractor/         # Article extraction
│   ├── sanitizer/         # Text cleaning
│   ├── highlighter/       # Sentence highlighting on page
│   └── inline-player/     # Floating mini-player
├── offscreen/             # Offscreen Document (DOM + WASM + Audio)
│   ├── index.html
│   ├── index.js           # Entry point
│   ├── audio/             # Web Audio API playback & scheduling
│   ├── tts/               # ONNX inference engines (kitten, piper)
│   ├── cache/             # IndexedDB model caching
│   └── utils/             # Phonemizer, ORT loader
├── popup/                 # Extension popup UI
│   ├── index.html
│   ├── index.js
│   ├── components/        # UI components (tabs, selectors, status bar)
│   └── styles/
├── options/               # Settings page
│   ├── index.html
│   └── index.js
├── shared/                # Cross-cutting utilities ONLY
│   ├── constants.js       # Voices, models, defaults, MSG types
│   ├── messaging.js       # Message helpers
│   ├── sentence-splitter.js
│   ├── storage.js
│   ├── logger.js          # Centralized logging
│   ├── state-tracker.js
│   └── extension-url.js
└── assets/                # Static files (filled at build time from legacy ext)
```

### Module Boundaries

**Allowed imports inside a module:**
- Its own code and styles
- Anything from `shared/`
- Chrome extension APIs (`chrome.runtime`, `chrome.storage`, etc.)

**NOT allowed:**
- Direct imports between feature modules (e.g. `popup/` cannot import from `content/`)
- Direct imports from `node_modules/` (use `shared/` wrappers if needed)

Modules communicate **exclusively** via `chrome.runtime.sendMessage()` using the
protocol defined in `src/shared/messaging.js`.

### Message Protocol

All messages use this shape:

```javascript
{
  target: 'background' | 'popup' | 'content' | 'offscreen',
  type: '<NOUN>_<VERB>',   // e.g. TTS_GENERATE, STATUS_PLAYING
  ...payload
}
```

Key message types are centralized in `src/shared/constants.js` under `MSG`.

### Communication Flow

```
Popup ◄──► Background ◄──► Content Script
              │
              ▼
          Offscreen  (WASM + Web Audio)
```

The **Background** service worker is the central router. It forwards messages
between popup, content scripts, and the offscreen document. It handles **ALL**
messages regardless of `target` field because of this forwarding role.

The **Offscreen** document is required because Chrome MV3 service workers cannot
run WASM or play audio. A Web Worker (`tts-worker.js`) isolates heavy ONNX
compute from the offscreen UI thread.

---

## Code Style Guidelines

### Formatting
- **2-space indentation**
- **Single quotes** for strings
- **Semicolons** required
- Import paths must include the `.js` extension (ES modules)

### Comments
- Use JSDoc for exported functions (`/** @param ... */`)
- Use visual section dividers for major sections:
  ```javascript
  // ── Section Name ──────────────────────────────────────────────────────────
  ```

### Logging
- **Never use `console.log()` directly** in module code.
- Use the centralized logger:
  ```javascript
  import { log } from '../shared/logger.js';
  log('bg', 'log', 'Message');       // source, level, ...args
  log('offscreen', 'error', 'Oops');
  ```
- The logger sends entries to both the browser console and the popup debug panel.

### Error Handling
- Catch errors and report them via the message protocol (`MSG.STATUS_ERROR`).
- Use `recordError()` from `shared/state-tracker.js` for diagnostic tracking.
- Async handlers in Chrome message listeners must return `true` to keep the
  message channel open for `sendResponse()`.

### Naming Conventions
- Constants: `UPPER_SNAKE_CASE` (e.g. `MSG.TTS_GENERATE`, `STORAGE_KEYS.SETTINGS`)
- Functions: `camelCase`
- Files: `kebab-case.js`
- Message types: `NOUN_VERB` (e.g. `EXTRACT_ARTICLE`, `STATUS_PLAYING`)

---

## Testing Instructions

### Test Setup
- **Runner:** Vitest with `globals: true`
- **Environment:** jsdom
- **Setup file:** `test/setup.js`
- **Test glob:** `test/**/*.test.js`

### Chrome API Mocks
The setup file mocks all Chrome extension APIs (`chrome.storage`, `chrome.runtime`,
`chrome.tabs`, `chrome.offscreen`, `chrome.contextMenus`, `chrome.commands`) using
Vitest `vi.fn()`. Session storage is backed by an in-memory `Map`.

Helpers exported from `test/setup.js`:
- `resetSessionStorage()` — cleared automatically before each test
- `getStored(key)` / `setStored(key, value)` — inspect/manipulate mock storage

### Running Tests
```bash
npm run test        # CI mode
npm run test:watch  # Interactive mode
```

### Coverage
Configured via `vitest.config.js`:
- Provider: `v8`
- Includes: `src/**/*.js`
- Excludes: `src/**/*.test.js`, `src/**/index.js`

### Adding Tests
Mirror the `src/` structure under `test/`:
```
test/content/sanitizer.test.js   → tests src/content/sanitizer/smart-cleaner.js
test/offscreen/scheduler.test.js → tests src/offscreen/audio/scheduler.js
```

---

## Security Considerations

- **CSP:** The manifest declares `script-src 'self' 'wasm-unsafe-eval'` because
  ONNX Runtime loads and executes WebAssembly.
- **No external network calls** for TTS inference — all models run locally.
- **Web accessible resources:** `assets/lib/*`, `assets/models/*` are exposed to
  all URLs so the offscreen document and worker can load WASM/models.
- **Offscreen document reason:** `AUDIO_PLAYBACK` / `DOM_PARSER` (Chrome MV3
  requirement).
- Model files and ONNX runtime libraries are copied from `tts-studio-extension/`
  (the legacy monolithic extension) during build. Do not commit generated assets
  to `src/assets/`.

---

## Build System Details

Vite configuration (`vite.config.js`) is customized for Chrome extensions:

| Input | Output |
|-------|--------|
| `src/background/index.js` | `dist/background.js` |
| `src/content/index.js` | `dist/content.js` |
| `src/offscreen/index.html` | `dist/offscreen/` |
| `src/popup/index.html` | `dist/popup/` |
| `src/options/index.html` | `dist/options/` |
| `src/offscreen/tts/tts-worker.js` | `dist/tts-worker/` |

A custom `closeBundle` plugin:
1. Flattens `dist/src/` into `dist/` (Vite preserves input paths)
2. Fixes relative paths in HTML files after flattening
3. Copies `src/manifest.json` → `dist/manifest.json`
4. Copies legacy static assets (`icons/`, `lib/`, `models/`) from `tts-studio-extension/`

---

## Storage Schema

```javascript
// chrome.storage.local
{
  settings: {
    defaultModel: 'piper',
    defaultVoice: '3922',
    defaultSpeed: 1.0,
    sanitization: { skipCodeBlocks, skipUrls, skipEmojis, readCodeComments, stripMarkdown },
    highlight: { color, style, opacity, autoScroll },
    executionProvider: 'webgpu' | 'cpu'
  },
  playback: { isPlaying, currentSentence, totalSentences, url },
  history: [{ url, title, domain, date, lastSentence, totalSentences }]
}
```

---

## Legacy Extension

The old monolithic extension lives in `tts-studio-extension/` for reference.
All new development happens in `src/`. The build system automatically copies
static assets (icons, ONNX runtime, models) from the legacy folder — do not
duplicate them.

---

## Troubleshooting Quick Reference

| Symptom | Check Module | File |
|---------|-------------|------|
| "Read article" does nothing | Content → Extractor | `src/content/extractor/index.js` |
| Hearing "slash slash" | Content → Sanitizer | `src/content/sanitizer/smart-cleaner.js` |
| Audio has gaps | Offscreen → Audio | `src/offscreen/audio/scheduler.js` |
| Wrong voice plays | Offscreen → TTS | `src/offscreen/tts/<model>.js` |
| Popup won't open | Popup | `src/popup/index.js` |
| Keyboard shortcut fails | Background | `src/background/commands.js` |
| Highlight not showing | Content → Highlighter | `src/content/highlighter/index.js` |
| Model won't load | Offscreen → Cache | `src/offscreen/cache/indexeddb.js` |

---

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
