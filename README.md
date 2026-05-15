# TTS Studio Extension

> Browser TTS with KittenTTS, Kokoro & Piper — 100% local, no server.

## 🏗️ Architecture

This extension uses a **feature-based modular architecture**. Each feature is self-contained in its own folder.

```
extension/
├── src/                 # ← Edit here (source code)
│   ├── background/      # Service worker (shortcuts, menus, routing)
│   ├── content/         # Content script (page extraction, highlighting)
│   ├── offscreen/       # TTS engine (ONNX + Web Audio)
│   ├── popup/           # Extension popup UI
│   ├── options/         # Settings page
│   ├── shared/          # Constants, utilities, messaging protocol
│   └── assets/          # Static files (filled at build time)
│
├── dist/                # ← Chrome loads this (built by Vite)
├── tests/               # Mirrors src/ structure
├── package.json         # npm deps + build scripts
├── vite.config.js       # Build configuration
└── ARCHITECTURE.md      # Full architecture docs
```

## 🚀 Development

```bash
cd extension
npm install
npm run build        # Build once
npm run dev          # Watch mode (rebuild on change)
```

## 📦 Loading in Chrome

1. Build: `npm run build`
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `extension/dist/` folder

## 🧩 Module Boundaries

| Module | What it does | If it breaks... |
|--------|-------------|----------------|
| `background/` | Message routing, keyboard shortcuts, context menus | Check `src/background/` |
| `content/extractor/` | Readability.js article extraction | Check `src/content/extractor/` |
| `content/sanitizer/` | Text cleaning (no more "slash slash") | Check `src/content/sanitizer/` |
| `content/highlighter/` | Sentence highlighting on page | Check `src/content/highlighter/` |
| `offscreen/audio/` | Web Audio playback | Check `src/offscreen/audio/` |
| `offscreen/tts/` | ONNX model inference (Kitten/Kokoro/Piper) | Check `src/offscreen/tts/<model>.js` |
| `popup/` | Extension popup UI | Check `src/popup/` |

## 📝 Adding a Feature

1. Create folder in the right module: `src/content/my-feature/`
2. Export from parent `index.js`
3. Add tests in `tests/content/my-feature.test.js`
4. Run `npm run build` to test

## 🔄 Migration from Old Structure

The old monolithic extension lives in `extension/tts-studio-extension/` for reference.
All new development happens in `extension/src/`.

The build system copies static assets (icons, models, lib) from the old extension automatically — no duplication needed.
