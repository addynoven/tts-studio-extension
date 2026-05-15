# Highlighting Upgrade Plan

> Word-level and sentence-level highlighting for TTS Studio

---

## The Problem

Current highlighting is **paragraph-level** — when a sentence plays, the entire `<p>` element gets a yellow background. This is imprecise and doesn't give the user a reading-along experience.

Goal: highlight the **exact word** being spoken, or at minimum the **exact sentence**.

---

## Feasibility Analysis

### Can we do word-level highlighting?

**Short answer: Yes, with estimated timing. Not pixel-perfect, but good enough.**

#### The hard part — timing

Neither Piper nor KittenTTS output word-level timestamps. The ONNX model returns a flat `Float32Array` of audio samples — no alignment data.

**Three approaches to get word timing:**

| Approach | Accuracy | Complexity | Performance |
|---|---|---|---|
| **A. Phoneme-proportional estimation** | ~85% | Medium | Free (math only) |
| **B. Forced alignment (Whisper/ASR)** | ~98% | High | Expensive (2nd model) |
| **C. Simple word-count distribution** | ~60% | Low | Free |

**Recommendation: Approach A** — We already have phoneme data from espeak-ng. Count phonemes per word, distribute the chunk duration proportionally. This gives surprisingly accurate results for English because phoneme count correlates strongly with spoken duration.

#### The easy part — CSS

The **CSS Custom Highlight API** (`::highlight()`) is perfect here:
- **Non-destructive** — uses `Range` objects, doesn't inject `<span>` tags into the page DOM
- **No layout breakage** — pages with React/Vue/complex layouts won't break
- **Fast** — just moving a Range is O(1), no DOM mutations
- **Chrome 105+** — we're a Chrome extension, guaranteed support

Old approach (deleted `word-highlighter.js`) used `<span>` wrapping via `Range.surroundContents()` — this mutates the DOM, can break page layouts, and is hard to clean up. The CSS Highlight API avoids all of that.

---

### Can we do sentence-level highlighting?

**Yes, with 100% accuracy.** We already have the exact sentence text (it's the chunk we sent to the TTS model). We just need to find it in the DOM and highlight exactly those characters instead of the whole `<p>`.

This is a strict upgrade from what we have now — same matching logic, but instead of adding a class to the parent element, we create a `Range` over the exact sentence text within the element.

---

## Architecture

### Data Flow

```
offscreen (Worker)                     content script (page)
   │                                        │
   │ synthesize chunk "In 2001,"             │
   │ audio = 1.2s, 5 phonemes               │
   │                                        │
   ├─── HIGHLIGHT_CHUNK ───────────────────►│
   │    { chunkText, duration,              │
   │      words: ["In","2001,"],            │
   │      wordTimings: [0, 0.4] }           │
   │                                        │
   │                                   ┌────▼─────────┐
   │                                   │ Find text in  │
   │                                   │ DOM via Range  │
   │                                   │ API            │
   │                                   └────┬─────────┘
   │                                        │
   │                                   ┌────▼─────────┐
   │                                   │ CSS.highlights │
   │                                   │ ::highlight()  │
   │                                   │ animates word  │
   │                                   │ by word        │
   │                                   └───────────────┘
```

### Two-tier highlighting

Both run simultaneously:
1. **Sentence highlight** (background glow) — highlights the full sentence being spoken. Uses `::highlight(tts-sentence)`.
2. **Word highlight** (bold foreground) — sweeps word-by-word within the sentence. Uses `::highlight(tts-word)`. Falls back to sentence-only if word timing is unreliable.

---

## Implementation Plan

### Phase 1: Sentence-level highlighting (100% accuracy)

**Files to create/modify:**

| File | Action |
|---|---|
| `src/content/highlighter.js` | **New** — replaces `chunk-highlighter.js`. Uses CSS Highlight API with Range. |
| `src/content/index.js` | Modify — import from new `highlighter.js` |
| `src/content/highlighter.css` | **New** — `::highlight()` styles |

**Steps:**
1. On first `HIGHLIGHT_CHUNK`, walk the DOM with `TreeWalker(SHOW_TEXT)` and build an ordered list of `{ textNode, startOffset, text }` entries — a flat "text map" of the page.
2. To highlight a sentence: binary-search the text map for the chunk text → create a `Range(startNode, startOffset, endNode, endOffset)` → register as `CSS.highlights.set('tts-sentence', new Highlight(range))`.
3. On next chunk, clear old highlight, set new one.
4. Auto-scroll the range into view.

**Why this is 100% accurate:** We're searching for the exact text string that was sent to the TTS model. The text map gives us character-level offsets in the DOM. No fuzzy matching needed.

**Edge case:** Sanitized text won't match raw page text (URLs stripped, etc.). Fix: store the *original* unsanitized sentence alongside the sanitized one and search for the original.

---

### Phase 2: Word-level highlighting (estimated timing)

**Additional files:**

| File | Action |
|---|---|
| `src/offscreen/utils/word-timing.js` | **New** — phoneme-proportional word timing estimator |
| `src/offscreen/index.js` | Modify — compute word timings, send with `HIGHLIGHT_CHUNK` |
| `src/content/highlighter.js` | Modify — add `requestAnimationFrame` word-sweep loop |

**Steps:**
1. **In the Worker/offscreen:** After synthesizing a chunk, split the chunk text into words. For each word, count its phonemes (we already have the phoneme string from espeak-ng). Distribute the chunk's audio duration proportionally: `wordDuration = (phonemesInWord / totalPhonemes) * chunkDuration`.
2. **Send word timings** in the `HIGHLIGHT_CHUNK` message:
   ```js
   {
     chunkText: "In 2001, Lakhani was invited",
     duration: 2.1,
     words: ["In", "2001,", "Lakhani", "was", "invited"],
     wordOffsets: [0, 3, 9, 17, 21],  // char offsets in chunkText
     wordTimings: [0, 0.3, 0.7, 1.2, 1.5]  // start time in seconds
   }
   ```
3. **In the content script:** When a chunk starts playing, create Range objects for each word (using char offsets + the text map). Start a `requestAnimationFrame` loop that checks elapsed time and moves `CSS.highlights.set('tts-word', ...)` to the current word.
4. **Fallback:** If phoneme data is unavailable, fall back to simple `duration / wordCount` distribution.

---

### Phase 3: CSS Design

```css
/* Sentence — subtle background glow */
::highlight(tts-sentence) {
  background-color: rgba(255, 235, 59, 0.15);
  border-radius: 2px;
}

/* Active word — stronger highlight */
::highlight(tts-word) {
  background-color: rgba(255, 235, 59, 0.5);
  color: inherit;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  ::highlight(tts-sentence) {
    background-color: rgba(251, 191, 36, 0.12);
  }
  ::highlight(tts-word) {
    background-color: rgba(251, 191, 36, 0.4);
  }
}
```

**Key:** The CSS Highlight API handles all of this without touching the page's DOM tree. No `<span>` injection, no layout reflow, no React hydration breakage.

---

## Difficulty Assessment

| Task | Difficulty | Time | Why |
|---|---|---|---|
| Build text map (TreeWalker) | Easy | 1h | Straightforward DOM walking |
| CSS Highlight API integration | Easy | 1h | Well-documented, Chrome-native |
| Sentence-level Range matching | Medium | 2h | Need to handle sanitized vs raw text |
| Phoneme-proportional timing | Medium | 2h | Need to align phoneme string back to words |
| Word-sweep rAF loop | Easy | 1h | Standard animation pattern |
| Auto-scroll | Easy | 30m | `range.getBoundingClientRect()` |
| Edge cases (tables, SPAs, iframes) | Hard | 2-3h | Real-world pages are messy |

**Total estimate: ~2 days of focused work.**

---

## Existing Code We Can Reuse

- `chunk-highlighter.js` — `buildPageIndex()`, `normalizeText()`, `isVisible()` logic can be adapted
- `phonemize.js` — already gives us the phoneme string per chunk
- `scheduler.js` timing callback — already sends `duration` with each chunk

## What We Delete

- `chunk-highlighter.js` — replaced entirely by the new `highlighter.js`

---

## Recommended Order

```
Step 1: Build highlighter.js with sentence-level (Phase 1)
        → Ship this. It's already a massive upgrade from paragraph-level.

Step 2: Add word-timing estimation (Phase 2)
        → Ship word-level on top of sentence-level.

Step 3: Polish CSS and edge cases (Phase 3)
        → Dark mode, scroll behavior, SPA navigation cleanup.
```
