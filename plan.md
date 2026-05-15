# TTS Studio — Problem Audit & Fix Plan

> Generated from `code-review-graph detect-changes`, `graphify query`, and manual code review.
> Last updated: 2026-05-15

---

## Problems (by severity)

### 🔴 P0 — Critical (Extension is broken / unusable)

---

#### 1. WebGPU Execution Provider — Completely Ignored

**Symptom:** The popup has a GPU toggle, but flipping it does nothing. Both models always run on WASM-CPU.

**Root Cause:** The `useGPU` flag is sent from `popup/index.js:128` → `offscreen/index.js:102` in the message payload, but `handleGenerate()` **never passes it** to `loadModel()` or `generateAudio()`. Both `piper.js:38` and `kitten.js:40-42` hardcode `executionProviders: [{ name: 'wasm' }]`.

**Files:**
- `src/offscreen/tts/piper.js` — L37-40: hardcoded `wasm`
- `src/offscreen/tts/kitten.js` — L40-42: hardcoded `wasm`
- `src/offscreen/index.js` — L102: `useGPU` destructured but never forwarded

**Fix Plan:**
1. Thread `useGPU` through `loadModel(model, onProgress, useGPU)` → `loadPiper(onProgress, useGPU)` → session creation.
2. When `useGPU === true`, set `executionProviders: ['webgpu', { name: 'wasm', simd: true }]` (fallback chain).
3. Add a WebGPU availability check (`navigator.gpu?.requestAdapter()`) and silently fall back to WASM if unavailable — don't error.
4. Some ONNX ops (like `GatherElements`) may not be supported on WebGPU. If session creation fails on `webgpu`, catch and retry with WASM. Log a warning.
5. Consider running a warmup inference after session creation to JIT-compile GPU kernels.

---

#### 2. UI Freezes — Popup & Extension Become Unresponsive During Generation

**Symptom:** When you click "Generate", the popup locks up, buttons stop responding, and the whole extension feels frozen until synthesis completes.

**Root Cause:** ONNX `InferenceSession.run()` is a heavy synchronous-ish operation that blocks the offscreen document's main thread. While the offscreen doc is technically separate from the popup, Chrome throttles extension messaging when any extension context is under heavy load. The `startNext()` function at `offscreen/index.js:186-227` fires up to 2 concurrent synthesis calls (`runningCount < 2`), doubling the CPU pressure.

Additionally, the polling loop at `offscreen/index.js:251-258` uses a tight `setInterval(100ms)` that adds unnecessary overhead.

**Files:**
- `src/offscreen/index.js` — L186-258: synthesis loop
- `src/offscreen/tts/piper.js` — L59-64: `piperSession.run()` blocks thread
- `src/offscreen/tts/kitten.js` — L59-63: `kittenSession.run()` blocks thread

**Fix Plan:**
1. **Move ONNX inference to a Web Worker inside the offscreen document.** The offscreen doc spawns a Worker, sends text+config, Worker runs `InferenceSession.run()`, posts back `Float32Array`. This completely isolates the heavy compute from Chrome's message loop.
2. **Reduce concurrency to 1.** Change `runningCount < 2` → `runningCount < 1`. With gapless scheduling, one-at-a-time is fine — the next chunk starts synthesizing the moment the previous one finishes.
3. **Replace the `setInterval` polling** with a Promise-based approach (resolve the outer promise from the `startNext` callback when `completedCount >= totalChunks`).
4. **Add `requestIdleCallback` or `scheduler.yield()` between chunks** to let Chrome process pending messages and keep the popup responsive.

---

### 🟠 P1 — Major (Feature is broken or severely degraded)

---

#### 3. KittenTTS — Too Slow, Tries to Generate Entire Page at Once

**Symptom:** KittenTTS takes forever. It tries to synthesize massive chunks (up to 350 chars) and the user waits a long time before hearing anything.

**Root Cause:** `offscreen/index.js:164` — KittenTTS uses `chunkSentences(sentences, 350)` which groups multiple sentences into ~350-char blobs. KittenTTS runs at ~1.77x RTF (real-time factor), meaning a 10-second audio clip takes ~5.6 seconds to generate. For a full article this compounds badly.

Also: KittenTTS has a naive resampling function for speed adjustment at `kitten.js:69-77` that does simple nearest-neighbor interpolation — this introduces audible artifacts at non-1.0 speeds.

**Fix Plan:**
1. **Reduce KittenTTS chunk size** to ~150 chars or switch to sentence-level like Piper. The gapless scheduler handles pause insertion regardless of chunk size.
2. **Stream-first architecture:** Don't wait for ALL chunks to synthesize. The scheduler already plays chunks as they arrive. The only change needed is removing the `await new Promise(...)` polling at L251-258 and letting the function resolve early after kicking off `startNext()`.
3. **Fix the resampling:** Replace nearest-neighbor with linear interpolation, or better yet, apply speed via the `AudioBufferSourceNode.playbackRate` property on the Web Audio API side (zero-cost, hardware-accelerated).

---

#### 4. Piper — Bullet-Train Cadence (Partially Fixed)

**Symptom:** Piper reads everything without pausing at commas, periods, or paragraph breaks.

**Root Cause:** Previously, Piper chunks were too large and the pause durations were too short. This was **partially fixed** in the last session by splitting at commas/semicolons at `offscreen/index.js:157-165` and increasing pause durations at `offscreen/index.js:85-90`.

**Remaining issues:**
- The comma-splitting regex `$1\n` can produce very short fragments (single words like "In 2001,") that sound choppy.
- `isFollowedByParagraph()` at `offscreen/index.js:93-98` uses `originalText.indexOf(sentence)` which can match the wrong occurrence if the same phrase appears twice.
- Pause durations are not scaled by `speed` — at 1.5x speed, pauses should be shorter.

**Fix Plan:**
1. Set a minimum chunk length (e.g. 20 chars). If a comma-split fragment is too short, merge it with the next fragment.
2. Fix `isFollowedByParagraph()` to track character offsets cumulatively instead of using `indexOf()`.
3. Scale pauses: `pauseDuration / speed` so faster playback feels natural.

---

#### 5. Highlighting Sync — Still Fragile

**Symptom:** Highlighting sometimes jumps to the wrong paragraph, or highlights nothing.

**Root Cause:** The chunk-highlighter at `chunk-highlighter.js:122-150` does a **full-page DOM scan** on every chunk using `querySelectorAll(CANDIDATE_SELECTORS.join(', '))` — this is O(n) over all visible elements per chunk. The fuzzy matching via `computeMatchScore()` compares individual words, which can pick the wrong `<p>` when the article has similar vocabulary across paragraphs.

The timing fix from last session (delaying `timingCallback` via `setTimeout`) works but `setTimeout` in an offscreen doc under heavy CPU load can drift by 50-200ms.

**Fix Plan:**
1. **Pre-index the page once** when TTS starts. Walk the DOM, build a map of `{ element, textContent }` entries. On each chunk, search this index instead of re-querying the DOM.
2. **Use substring matching first**, fall back to fuzzy only if substring fails. The current code does it backwards (fuzzy first).
3. **Track sequential position**: since chunks play in order, start searching from the last highlighted element's position in the DOM, not from the top of the page.
4. Consider using `word-indexer.js` (already exists but is completely unused!) to provide precise word-level highlighting instead of paragraph-level.

---

### 🟡 P2 — Medium (Technical debt / resource leaks)

---

#### 6. Dual AudioContext — `player.js` and `scheduler.js` Both Create Their Own

**Symptom:** Two separate `AudioContext` instances exist. Memory waste, potential audio routing conflicts.

**Root Cause:** `player.js` has its own `getAudioCtx()` at L10-15, while `scheduler.js` has `getContext()` at L31-38. They never share. The multi-chunk flow uses the scheduler, but the single-sentence path at `offscreen/index.js:143` uses `createAudioBuffer` from the scheduler but plays through the scheduler's context — so `player.js` is essentially **dead code** now.

**Fix Plan:**
1. Remove `player.js` entirely — it's unused. All playback goes through the scheduler now.
2. Or: extract a shared `getAudioContext()` into a tiny `audio/context.js` module that both can import.

---

#### 7. Dead Code & Unused Modules

**Symptom:** Multiple files exist that are never imported or used.

**Findings from graph analysis:**
- `player.js` — `playFloat32()` and `stopAudio()` are never called from the current flow.
- `word-highlighter.js` — 201 lines, never imported by `content/index.js`. The content script only uses `chunk-highlighter.js`.
- `word-indexer.js` — 139 lines, never imported anywhere.
- `src/shared/syllables.js` — exists but zero imports found.
- `offscreen.js` (root) — 16KB legacy file with old Kokoro references, `generateKokoro()`, `loadKokoro()`, etc. Not used by the Vite build.

**Fix Plan:**
1. Delete `player.js`, `syllables.js`, and root `offscreen.js`.
2. Keep `word-highlighter.js` and `word-indexer.js` if you plan to add word-level highlighting (P1 #5 above), otherwise delete.

---

#### 8. ORT Loaded Twice

**Symptom:** Both `piper.js:14-21` and `kitten.js:15-22` have their own `loadORT()` with their own `let ort = null;` cache.

**Root Cause:** If a user switches models mid-session (Piper → Kitten), ORT gets imported twice into two separate module-scoped variables. It's the same WASM binary loaded twice.

**Fix Plan:**
1. Extract `loadORT()` into a shared `offscreen/utils/ort-loader.js` module with a single cached `ort` instance.
2. Both `piper.js` and `kitten.js` import from it.

---

### 🟢 P3 — Low (Missing features / polish)

---

#### 9. No Pause/Resume — Only Stop

**Symptom:** The user can only stop playback entirely. There's no way to pause and resume where you left off.

**Root Cause:** The scheduler uses `AudioContext.close()` on stop at `scheduler.js:154`, which destroys everything. There's no concept of suspend/resume.

**Fix Plan:**
1. On pause: call `ctx.suspend()` instead of `close()`. This freezes playback at the current position.
2. On resume: call `ctx.resume()`. Playback continues exactly where it stopped.
3. Add `MSG.TTS_PAUSE` and `MSG.TTS_RESUME` message types.
4. Update popup with a play/pause toggle button.

---

#### 10. No Streaming — User Waits for First Chunk Before Hearing Anything

**Symptom:** There's a noticeable delay between clicking "Generate" and hearing any audio, especially on KittenTTS.

**Root Cause:** The architecture does stream (scheduler plays chunks as they arrive), but the first chunk still needs to fully synthesize before anything plays. For KittenTTS with 350-char chunks, this can be 3-5 seconds of silence.

**Fix Plan:**
1. Reduce first chunk size aggressively (e.g. first chunk = 1 sentence, max 80 chars).
2. Start synthesis of chunk 0 immediately, don't wait for the timeline/state setup to complete.
3. Show a "buffering..." indicator in the popup during the initial wait.

---

#### 11. No Skip Forward / Skip Backward Implementation

**Symptom:** Keyboard shortcuts `Alt+Shift+N` (next) and `Alt+Shift+P` (prev) are registered in `manifest.json:28-41` and handled in `commands.js`, but there's no logic to actually skip to the next/previous sentence in the scheduler.

**Fix Plan:**
1. Add `skipToChunk(index)` to `scheduler.js` — clears queue, resets `nextStartTime`, re-enqueues from the target index.
2. Wire `MSG.TTS_SKIP_FORWARD` / `MSG.TTS_SKIP_BACKWARD` messages.

---

#### 12. Read Aloud (Reference Extension) — Lessons to Apply

You mentioned wanting to learn from [ken107/read-aloud](https://github.com/ken107/read-aloud). Key patterns worth adopting:

| Read Aloud Pattern | Our Current State | Action |
|---|---|---|
| Cloud TTS fallback (Google Wavenet, Azure, etc.) | Local-only | Consider adding a cloud voice option for quality comparison |
| Sentence-by-sentence streaming | We batch-then-play | Already partially addressed — just need smaller first chunk |
| `AudioContext.suspend()/resume()` for pause | We destroy context on stop | Implement P3 #9 |
| Pre-parses page structure before TTS starts | We parse on-demand | Pre-index on page load or on first generate |

---

## Recommended Fix Order

```
Phase 1 — Stop the Bleeding (make it usable)
  ├── P0 #2: Move inference to Web Worker (fixes UI freezing)
  ├── P1 #3: Reduce KittenTTS chunk size + stream-first
  └── P2 #6: Kill dual AudioContext (player.js cleanup)

Phase 2 — WebGPU + Quality
  ├── P0 #1: Thread useGPU through to ONNX session creation
  ├── P1 #4: Polish Piper cadence (min chunk length, scale pauses)
  └── P2 #8: Shared ORT loader

Phase 3 — UX Polish
  ├── P1 #5: Fix highlighting (pre-index, sequential search)
  ├── P3 #9: Pause/Resume
  ├── P3 #10: Faster time-to-first-audio
  └── P3 #11: Skip forward/backward

Phase 4 — Cleanup
  └── P2 #7: Delete dead code
```

---

*Run `code-review-graph detect-changes` after each phase to verify blast radius.*
