# Agent Onboarding Guide

Welcome to the TTS Studio Extension codebase. As an AI agent working in this repository, you must adhere to the following architecture rules and tool workflows.

## 1. Graph-First Exploration
**Do not use generic `grep` or manual file browsing to explore cross-module dependencies.**
This project maintains a continuous AST and Semantic knowledge graph. 
- Use `code-review-graph detect-changes` before proposing refactors to check blast radius.
- Use `code-review-graph update` after you modify files.
- Use `graphify query "..."` to ask architectural questions.
- Read `.code-review-graph/wiki/index.md` for a community-based breakdown of the modules.

## 2. Core Architecture
This is a Chrome MV3 Extension built with Vite. It follows a **Feature-Driven Modular Monolith** architecture.
- **No Circular Imports**: Dependencies must flow one way.
- **Message Passing ONLY**: Modules (`popup`, `content`, `offscreen`) NEVER import from each other. They communicate exclusively by sending `{ target, type, payload }` messages routed through `src/background/index.js`.
- **Shared Folder**: The ONLY place where cross-module code lives is `src/shared/`.

### Key Domains
- `src/background/`: The Central Router. Handles all `chrome.runtime` message routing, shortcut keys, and service-worker state.
- `src/offscreen/`: The Audio Engine. Lives in a hidden DOM. Contains Web Audio API scheduling (`offscreen/audio/scheduler.js`), WASM inference for local ONNX TTS models (`offscreen/tts/`), and IndexedDB caching.
- `src/content/`: The DOM Manipulator. Injected into user web pages. Handles parsing articles (`content/extractor/`), sanitizing text (`content/sanitizer/`), and highlighting words visually (`content/highlighter/`).
- `src/popup/`: The UI. Pure React/Vanilla components that just dispatch actions and display status.

## 3. The User's Engineering Style
- **Clarity over cleverness**: Keep abstractions minimal. One function = one job.
- **Feature-first over layer-first**: Group code by feature (e.g. `content/sanitizer/`), NEVER by layers (no `controllers/`, `services/`, `models/` folders).
- **Integration Tests Default**: Add tests matching the style in `tests/` when you add new features. Focus on black-box module behavior.
- **Strict Typing/Validation**: Validate all inputs at the boundary. Fail fast.

## 4. Debugging Cheat Sheet
- **Highlighting out of sync?** Check `src/offscreen/audio/scheduler.js` (timing callback) and `src/content/chunk-highlighter.js`.
- **"Bullet Train" TTS?** The model isn't pausing. Check chunking logic in `src/offscreen/index.js` or `shared/sentence-splitter.js`.
- **Message not arriving?** Verify it's being correctly forwarded in `src/background/index.js`.
- **Model downloading fails?** Check `src/offscreen/cache/indexeddb.js`.

Whenever you start a session here, run `code-review-graph status` to orient yourself!
