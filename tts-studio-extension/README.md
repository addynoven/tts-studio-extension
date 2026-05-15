# 🎙️ TTS Studio — Browser Extension

A Chrome extension that runs **KittenTTS, Kokoro, and Piper** 100% in your browser.
No server. No Python. No internet required after install. All models bundled locally.

---

## Engine status

| Engine | Status | Notes |
|--------|--------|-------|
| 🌸 **Kokoro** | ✅ Working | 21 voices via ONNX Runtime Web + phonemizer.js + local voice embeddings |
| 😻 **KittenTTS** | ✅ Working | 8 voices via ONNX Runtime Web + phonemizer.js (espeak-ng WASM) |
| 🃏 **Piper** | ✅ Working | 8 voices via ONNX Runtime Web + phonemizer.js (espeak-ng WASM) |

---

## Quick start

### 1. Load the extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select this folder (`tts-studio-extension/`)

### 2. Generate speech

- Click the extension icon in your toolbar
- Pick a model, voice, speed
- Type or paste text → **Generate**

### 3. Read selected text

- Select text on any webpage
- Right-click → **Read with TTS Studio**
- Or: select text, open popup, click **📋 Selected**

---

## File structure

```
tts-studio-extension/
├── manifest.json           Chrome MV3 config
├── background.js           Service worker — routing, context menu
├── content.js              Injected into pages — grabs selection
├── popup/
│   ├── popup.html          UI (model tabs, voice, speed, textarea)
│   └── popup.js            UI logic + chrome.storage persistence
└── offscreen/
    ├── offscreen.html      Hidden page with full DOM + WASM privileges
    └── offscreen.js        All TTS engines + IndexedDB model cache
```

**Key insight — why offscreen?**  
Chrome MV3 service workers can't run WebAssembly or play audio.
The offscreen document is a hidden HTML page that *can* — so all ONNX inference
and Web Audio playback happens there. The service worker just routes messages.

---



## Model sizes & first-load times

All models are bundled locally in the extension. No downloads needed.

| Model | Size | Load time |
|-------|------|-----------|
| KittenTTS Nano | ~24 MB | Instant |
| Kokoro | ~99 MB | Instant |
| Piper LibriTTS | ~75 MB | Instant |

---



## Permissions used

| Permission | Why |
|------------|-----|
| `activeTab` | Read selected text from the current page |
| `contextMenus` | "Read with TTS Studio" right-click menu |
| `storage` | Persist settings (model, voice, speed) across popup opens |
| `offscreen` | Create the hidden WASM/audio execution context |
| host: `huggingface.co` | *(no longer needed — models bundled locally)* |
| host: `cdn.jsdelivr.net` | *(no longer needed — JS libs bundled locally)* |

---

## Adding more Piper voices

Piper has 904 voices from the LibriTTS dataset. Add speaker IDs to the
`VOICES.piper` array in `popup/popup.js`:

```js
{ id: 'p240', label: 'p240 — Female, US' },
{ id: 'p260', label: 'p260 — Male,   US' },
```

Full speaker list: https://huggingface.co/rhasspy/piper-voices
