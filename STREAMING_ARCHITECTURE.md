# TTS Studio — Streaming Architecture Plan

> **Status:** Design document — not yet implemented  
> **Original vision:** Microsoft Edge "Read Aloud" for Chrome, with local AI voices (Piper, KittenTTS), fully offline  
> **New evolution:** Streaming pipeline — from batch "slurp entire page" to per-paragraph lazy extraction

---

## 1. Original Vision (Why We Started)

### What We Saw in Microsoft Edge
- Built-in **Read Aloud** reads any webpage or PDF
- Highlights sentence/paragraph as TTS speaks it
- Floating control bar: play, pause, skip, speed
- Click anywhere on page → starts reading from there
- Works on infinite documents without crashing

### What We Want to Build
> A Chrome extension that does everything Edge Read Aloud does, but:
> - Works on **any Chromium browser** (Chrome, Brave, Edge, Opera)
> - Uses **local AI voices** — Piper (904 voices, 75MB) and KittenTTS (8 voices, 24MB)
> - Runs **100% offline** — no cloud, no subscription, no data leaves the computer
> - Full control over voices, speed, highlighting style

### Core Features
| Feature | Edge | Our Extension |
|---|---|---|
| Read webpage aloud | ✅ | ✅ |
| Highlight while speaking | ✅ | ✅ |
| Pause / resume | ✅ | ✅ |
| Skip forward/backward | ✅ | ✅ |
| Speed control | ✅ | ✅ |
| Click-to-read-from-here | ✅ | ❌ (not yet) |
| Floating control bar on page | ✅ | ❌ (not yet) |
| PDF support | ✅ | ❌ (not yet) |
| Offline / local voices | ❌ | ✅ |
| 900+ voice choices | ❌ | ✅ |

---

## 2. The Problem We Hit (Batch Architecture)

### Current Flow (What Exists Today)
```
User clicks "Read Article"
         ↓
Content script extracts ENTIRE page via Readability
         ↓
Builds array of ALL blocks (could be 10,000+)
         ↓
Joins all text into one giant string
         ↓
Sends full text to background
         ↓
Background forwards to offscreen document
         ↓
Offscreen splits into sentences, generates ALL audio
         ↓
Finally starts playing
```

### Why This Breaks on Real Content
| Scenario | What Happens |
|---|---|
| 1000-page PDF | Browser kills the tab (out of memory) |
| Infinite scroll (Twitter, Reddit) | Extracts once, misses new content |
| Wikipedia article with math | 30-second freeze while sanitizing everything |
| Long novel on web reader | 10-second delay before first audio |
| User clicks paragraph 500 | Can't jump there — only has full text |

**The root cause:** We treat the web like a document to be slurped whole. The web is a stream.

---

## 3. The New Architecture (Streaming Pipeline)

### Core Idea
> Don't extract the whole page. Extract **one paragraph at a time**. Keep **5 paragraphs ahead** in a text buffer. Pre-generate **1 paragraph ahead** in an audio buffer. Play immediately. Repeat forever.

### The Two-Tier Buffer

```
┌─────────────────────────────────────────────────────────────┐
│  TEXT BUFFER (upstream)          AUDIO BUFFER (downstream)  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Block 5  [fetched, sanitized]      Audio 2  [pre-generated]  │
│  Block 4  [fetched, sanitized]      Audio 1  [playing NOW]    │
│  Block 3  [fetched, sanitized]                                │
│  Block 2  [fetched, sanitized]                                │
│  Block 1  [played]                                            │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

| Tier | Size | Holds | Purpose |
|---|---|---|---|
| **Text Buffer** | 5 blocks | Extracted + sanitized text | Always have content ready for TTS |
| **Audio Buffer** | 1-2 blocks | PCM audio blobs | Pre-generate while user listens, zero gap playback |

### Why This Works

**TTS is faster than real-time:**
| Engine | Generation Speed | Can It Keep Up? |
|---|---|---|
| Piper | ~5-10× realtime | 2-sec audio in ~200ms |
| KittenTTS | ~2-4× realtime | 2-sec audio in ~500ms |

While the user listens to a 10-second paragraph, the TTS worker has 5-10 seconds of wall-clock time to generate the next one. It finishes **before** playback ends.

### The Infinite Loop

```javascript
while (user is listening) {
  // 1. Keep text buffer full
  if (textBuffer.length < 5 && !atEndOfDocument) {
    nextBlock = contentScript.extractNextBlock();
    textBuffer.push(sanitize(nextBlock));
  }

  // 2. Keep audio buffer full
  if (audioBuffer.length < 2 && textBuffer.length > 0) {
    text = textBuffer.shift();
    audio = await ttsEngine.generate(text);
    audioBuffer.push(audio);
  }

  // 3. Play current, advance
  if (currentAudio.finished) {
    play(audioBuffer.shift());
    highlightNextBlock();
  }
}
```

---

## 4. Message Protocol Changes

### Current (Batch — Dies on Long Docs)
```
content ──EXTRACT_ARTICLE─────────────→ background
              (no response needed)

content ──ARTICLE_EXTRACTED(fullText)──→ background
                                              ↓
background ──TTS_GENERATE(allText)─────→ offscreen
                                              ↓
offscreen ──STATUS_PLAYING─────────────→ popup
offscreen ──HIGHLIGHT_CHUNK(text)──────→ content
```

### New (Streaming — Scales to Infinity)
```
// Startup: content tells background it's ready to stream
content ──STREAM_START(url, title)──────→ background
                                              ↓
background ──REQUEST_BLOCK(index=0)────→ content
                                              ↓
content ──BLOCK_READY(block, index, isLast)→ background
                                              ↓
background ──TTS_BUFFER(block, index)──→ offscreen
                                              ↓
offscreen ──STATUS_PLAYING─────────────→ popup
offscreen ──HIGHLIGHT_BLOCK(el, text)──→ content

// Refill: when offscreen buffer drops, background asks for more
background ──REQUEST_BLOCK(index=N)────→ content
```

### New Message Types
```javascript
MSG.STREAM_START       // content → background: user wants to read this page
MSG.REQUEST_BLOCK      // background → content: send block N
MSG.BLOCK_READY        // content → background: here's block N (with isLast flag)
MSG.TTS_BUFFER         // background → offscreen: add this block to text buffer
MSG.HIGHLIGHT_BLOCK    // offscreen → content: highlight this DOM element
MSG.STREAM_END         // background → popup: no more blocks
```

---

## 5. What Dies, What Lives, What Needs Surgery

### 🗑️ BECOMES USELESS (Batch Architecture)

| File / Function | Why It Dies |
|---|---|
| `extractMappedArticle()` returning `{ blocks[], title, fullText }` | No more "full article". One block at a time. |
| `articleBlocks` holding ALL blocks in memory | Memory bomb on 1000-page PDF |
| `blockToChunkMap` | Mapping all blocks upfront is wasteful. Window is 5 blocks. |
| `fullText` generation | Joining all blocks into one string is the anti-pattern |
| `ARTICLE_EXTRACTED` message with full payload | Becomes `BLOCK_READY` per-block messages |
| `findBlockForChunk()` searching all blocks | Only 5 blocks in window. Search is trivial. |
| `setMappedBlocks(blocks)` | Only need `setCurrentBlock(el)` for highlighting |
| Background `ARTICLE_EXTRACTED → TTS_GENERATE` one-shot | Becomes continuous stream relay |

### 🔧 NEEDS MAJOR SURGERY

| File / Function | What Changes |
|---|---|
| `content/extractor/dom-mapper.js` | `extractMappedArticle()` → `extractNextBlock(cursor)` or generator. `walkBlocks()` becomes stateful / incremental. Readability clone is fine (find root once), but walking must resume from cursor. |
| `content/index.js` | `handleExtractArticle()` no longer returns full article. Returns first block + starts background fetching loop. `articleBlocks` becomes `{ currentBlock, buffer: [], cursor }`. |
| `content/highlighter.js` | `setMappedBlocks()` → `setCurrentBlock()`. `highlightByIndex()` → `highlightBlock()`. Only one highlight at a time. |
| `offscreen/index.js` | Currently: load model → get full text → split all sentences → generate all → enqueue. New: accept blocks incrementally → text buffer holds 5 → TTS pre-generates audio for N+1 → enqueue when ready. |
| `background/index.ts` | Routing changes from one-shot `ARTICLE_EXTRACTED → TTS_GENERATE` to streaming relay with backpressure. |

### ✅ SURVIVES UNCHANGED

| File / Function | Why It Lives |
|---|---|
| `offscreen/audio/scheduler.js` | **Already architecturally correct.** It's an indexed queue with async chunk arrival. `enqueueChunk(index, buffer)` works perfectly for streaming. Just feed blocks as they arrive. |
| `offscreen/tts/index.js` | Router doesn't care about batch vs stream. Feed text, get audio. |
| `offscreen/tts/piper.js` | Same. Load model once, generate per sentence. |
| `offscreen/tts/kitten.js` | Same. |
| `content/sanitizer/smart-cleaner.js` | Sanitization logic is correct. Just called per-block instead of per-article. |
| `shared/sentence-splitter.js` | Splits text into sentences. Works on a single block perfectly. |
| `popup/` UI components | They just show status. Status updates come from the same scheduler callbacks. |
| `shared/storage.ts` | Settings, history, playback state — unchanged. |
| `shared/logger.ts` | Logging infrastructure — unchanged. |
| `shared/state-tracker.ts` | Phase tracking — unchanged. |
| `shared/constants.ts` | Needs new message types, but structure stays. |

### 🆕 NEW THINGS NEEDED

| Component | Purpose |
|---|---|
| **BlockIterator** in content script | Walks DOM lazily, yields one block per call, maintains cursor position. Resumes from last position. |
| **Text Buffer Manager** in offscreen | Holds 5 sanitized blocks. Fetches next when buffer drops below threshold. |
| **Audio Pre-Generator** in offscreen | Takes block N+1 from text buffer, generates audio, puts in audio buffer. Runs in idle time while user listens. |
| **End-of-Document Signal** | `isLastBlock: true` flag in `BLOCK_READY` so TTS knows to close gracefully instead of waiting forever. |
| **Skip Invalidation Logic** | User jumps to block 100 → flush text buffer + audio buffer, seek iterator to 100, resume streaming from there. |
| **Pause / Resume Coordination** | Pause = stop playback + stop fetching. Resume = start playback + resume filling buffers. |

---

## 6. Edge Cases & Behaviors

| Event | Behavior |
|---|---|
| **User clicks "Read Article"** | Extract block 0 immediately → start playing block 0 while quietly fetching blocks 1-5 |
| **User skips to block 100** | Flush all buffers. Seek iterator to 100. Fetch 100-105. Start playing 100 immediately. |
| **User pauses** | Stop playback. Stop fetching. Keep current buffers. Resume = instant. |
| **Page is short (< 5 blocks)** | Fetch all. `isLastBlock: true` on final block. Audio buffer drains naturally. |
| **Infinite scroll (Twitter, Reddit)** | Iterator keeps scanning. New blocks appear as user scrolls. Stream never ends until user stops. |
| **1000-page PDF** | Iterator walks one page at a time. Memory stays flat (~5 blocks). Works. |
| **CPU throttled / slow generation** | Audio buffer drains → brief pause → catches up. Rare with local TTS (5-10× realtime). |
| **User changes voice mid-stream** | Flush audio buffer (text buffer untouched). Regenerate with new voice. Seamless. |
| **Block is super long (60 sec speech)** | Audio buffer might only hold 1 block. Still fine — generation stays ahead of playback. |

---

## 7. The Honest Migration Cost

| Module | Effort | Notes |
|---|---|---|
| `audio/scheduler.js` | **0%** | Already perfect for streaming |
| `tts/*` (Piper, Kitten, router) | **0%** | Feed text, get audio. Don't care about source |
| `sanitizer/smart-cleaner.js` | **10%** | Call per-block instead of per-article |
| `shared/sentence-splitter.js` | **0%** | Already operates on arbitrary text |
| `popup/` UI | **10%** | Add stream status, maybe buffer depth indicator |
| `background/index.ts` | **40%** | New streaming relay logic |
| `content/index.js` | **60%** | New streaming protocol, state machine |
| `content/highlighter.js` | **30%** | Single-block highlighting instead of mapped array |
| `content/extractor/dom-mapper.js` | **80%** | Hardest part. Needs incremental / cursor-based walker |
| `offscreen/index.js` | **50%** | Dual buffer manager (text + audio), backpressure |

**Verdict:** It's a rewrite of the extraction and routing layers. The audio layer (scheduler + TTS engine) needs **zero changes**.

---

## 8. Block Size Optimization

Instead of raw DOM blocks (which vary wildly: some are 2 words, some are 200), re-chunk into consistent speech segments:

| Raw DOM Block | Re-chunked |
|---|---|
| Long paragraph (60 words) | 1 block (~15-20 sec speech) |
| Short paragraph (5 words) | Merge with next block |
| Heading + body | Merge heading into body block |
| List item | Merge consecutive items |

This keeps TTS rhythm consistent and the buffer predictable.

---

## 9. Why This Architecture Wins

| Aspect | Batch (Current) | Streaming (New) |
|---|---|---|
| Time to first audio | 2-10 seconds | **< 500ms** |
| Memory usage | Holds full article | **Holds 5 blocks** |
| 1000-page PDF? | Crashes / browser kill | **Yes** |
| Infinite scroll? | Extracts once, misses new | **Continuously fetches** |
| Skip to middle? | Has to regenerate everything | **Instant seek** |
| Pause/resume cost | None / full restart | **Instant** |
| Future LLM rewrite | Blocks until ALL done | **Background, per-block** |

---

## 10. Next Decision Point

Before writing any code, confirm:

1. **Are we committed to streaming?** (Yes/No)
2. **Block size strategy:** Raw DOM blocks or re-chunked to ~15-20 sec speech?
3. **Text buffer size:** 5 blocks? Configurable?
4. **Audio buffer size:** 1 block? 2 blocks?
5. **Do we keep the popup as primary UI** or build the floating inline player first?
6. **PDF support:** In-scope for streaming v1 or v2?

---

*Document written: 2026-05-16*  
*Purpose: Preserve architecture decisions if connection drops*
