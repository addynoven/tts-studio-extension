# 🎙️ TTS Studio — Production Workstation (v1.3.0)

> **Studio-grade, privacy-first Text-to-Speech inside Google Chrome.**  
> Powered by **Kokoro-82M** with WebGPU acceleration and **Instant Native OS** speech. 100% offline, zero cloud calls, zero telemetry.

---

## 🌟 Key Highlights

- 💎 **Kokoro-82M Neural Engine**: State-of-the-art 82M parameter open-weight TTS model generating ElevenLabs-quality 24kHz studio speech directly in your browser.
- ⚡ **Instant Native OS Dual-Engine**: 0ms instant startup with zero CPU drain via native `chrome.tts`, with automatic sentence chunking to eliminate Chrome's 15-second cutoff.
- 🏎️ **WebGPU Hardware Acceleration**: Blazing fast <100ms per sentence inference on your dedicated GPU (e.g. NVIDIA RTX 3060). Automatic self-healing fallback to multi-threaded CPU WASM using system RAM.
- 🎤 **Dual-Layer CSS Highlight API Karaoke**: Real-time non-destructive word-by-word (`::highlight(tts-word)`) and sentence (`::highlight(tts-active)`) tracking with zero DOM mutations—100% immune to React/Vue hydration breakage.
- 🔊 **Ambient In-Page UX**: Floating `🔊 Read` pill appears when selecting text anywhere on the web, paired with a draggable glassmorphic bottom mini-player with scrubbing, speed control, and pause/resume.
- 🧹 **Intelligent Text Sanitization**: Powered by Mozilla Readability and Speech Rule Engine (SRE)—automatically converts LaTeX and math formulas into natural spoken English while cleanly skipping code snippets, emojis, and raw URLs.
- 🔒 **100% Offline & Private**: Zero data leaves your computer. No telemetry, no API keys, no external servers. Persistent storage protection (`navigator.storage.persist()`) guarantees browser cache retention.

---

## 🎧 Curated Voice Catalog (28 Voices)

### American Voices
| Voice ID | Voice Name | Style / Tone |
| :--- | :--- | :--- |
| **`af_heart`** | **Heart (Default)** ⭐ | Warm, expressive, natural American female |
| `af_bella` | Bella | Soft, articulate American female |
| `af_nicole` | Nicole | Calm, gentle American female |
| `af_aoede` | Aoede | Melodic, rhythmic American female |
| `af_kore` | Kore | Crisp, clear American female |
| `af_sarah` | Sarah | Articulate, professional American female |
| `af_nova` | Nova | Dynamic, energetic American female |
| `af_sky` | Sky | Bright, upbeat American female |
| `af_alloy` | Alloy | Neutral, balanced American female |
| `af_jessica` | Jessica | Expressive, lively American female |
| `af_river` | River | Smooth, relaxed American female |
| `am_adam` | Adam | Clear, steady American male narrator |
| `am_michael` | Michael | Deep, authoritative American male |
| `am_fenrir` | Fenrir | Crisp, focused American male |
| `am_puck` | Puck | Casual, friendly American male |
| `am_echo` | Echo | Smooth, broadcast-quality American male |
| `am_eric` | Eric | Warm, conversational American male |
| `am_liam` | Liam | Bright, youthful American male |
| `am_onyx` | Onyx | Rich, baritone American male |
| `am_santa` | Santa | Jovial, friendly American male |

### British Voices
| Voice ID | Voice Name | Style / Tone |
| :--- | :--- | :--- |
| `bf_emma` | Emma | Articulate, elegant British female |
| `bf_isabella` | Isabella | Clear, classic British female |
| `bf_alice` | Alice | Gentle, refined British female |
| `bf_lily` | Lily | Soft, melodic British female |
| `bm_george` | George | Warm, authoritative British male |
| `bm_lewis` | Lewis | Classic, BBC-style British male |
| `bm_daniel` | Daniel | Refined, expressive British male |
| `bm_fable` | Fable | Storytelling, narrative British male |

---

## ⌨️ Global Keyboard Shortcuts

| Shortcut (Windows/Linux) | Shortcut (macOS) | Action |
| :--- | :--- | :--- |
| **`Alt + Shift + S`** | **`Option + Shift + S`** | **Play / Pause Speech** |
| **`Alt + Shift + R`** | **`Option + Shift + R`** | **Read Current Article / Selection** |
| **`Alt + Shift + N`** | **`Option + Shift + N`** | **Skip to Next Sentence** |
| **`Alt + Shift + P`** | **`Option + Shift + P`** | **Skip to Previous Sentence** |

*(You can customize these shortcuts anytime at `chrome://extensions/shortcuts`)*

---

## 🚀 Installation & Developer Setup

### 1. Build from Source
```bash
git clone <repo-url>
cd extension
npm install
npm run build
```

### 2. Load in Google Chrome
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle **Developer mode** on (top-right corner).
3. Click **Load unpacked** (top-left).
4. Select the `extension/dist/` directory.

### 3. Packaging for Chrome Web Store / Release
To generate a production-ready ZIP archive ready for Chrome Web Store upload or GitHub release:
```bash
npm run package
```
This will compile the extension and generate `tts-studio-v1.3.0.zip` at the project root.

---

## 🏎️ Hardware Acceleration & Hybrid Linux Laptops

### WebGPU Power Preference
TTS Studio automatically configures WebGPU with `powerPreference: 'high-performance'` to ensure Chrome requests your discrete GPU (such as NVIDIA GeForce RTX).

### Running with Discrete GPU on Linux (Optimus / PRIME)
On Linux laptops with hybrid Intel/AMD + NVIDIA graphics, launch Chrome with NVIDIA render offload to ensure Vulkan memory allocations use your dedicated VRAM:
```bash
__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia google-chrome
```

---

## 🏛️ Project Structure

```
src/
├── background/          # Manifest V3 service worker & Native OS TTS
├── content/             # In-page UI, floating player, CSS karaoke highlighter, sanitizer
├── offscreen/           # Offscreen document, Web Audio scheduler, Kokoro-82M neural engine
├── options/             # Dedicated settings workstation (chrome://extensions options)
├── popup/               # Extension popup with model tabs, voice picker & visualizer
└── shared/              # Unified state tracker, constants, storage, sentence splitter
```

---

## 🧪 Quality & Test Verification

- **Tests**: `npm run test` $\rightarrow$ **20 test suites, 185 tests passing**.
- **Typecheck**: `npm run typecheck` $\rightarrow$ **TypeScript strict mode, 0 errors**.
- **Linter**: `npm run lint` $\rightarrow$ **ESLint, 0 warnings, 0 errors**.
- **Build**: `npm run build` $\rightarrow$ **Vite production bundle in `dist/`**.
