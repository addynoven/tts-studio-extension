# TTS Studio — Sentence Highlighting Test Guide

## What you're testing
Sentence-level yellow highlighting on the web page as TTS reads aloud. The currently spoken sentence should glow yellow with a visible outline.

---

## Pre-requisites

1. **Extension is loaded** in `chrome://extensions` (Developer mode ON → Load unpacked → select `extension/dist/`)
2. **Reload the extension** after every build (click the ↻ refresh icon on the extension card)
3. **Use a page with readable article text** (e.g. Wikipedia, news site, blog post)

---

## Test Steps

### Step 1: Open a test page
- Go to any article page, e.g.
  - `https://en.wikipedia.org/wiki/Rayleigh_quotient_iteration`
  - Any Medium article, blog post, or news article

### Step 2: Open the page's DevTools console
- Press `F12` while on the article page (this opens the **page's** DevTools, NOT the popup)
- Click the **Console** tab
- Keep this open — you'll watch logs here

### Step 3: Trigger TTS
- **Option A:** Click the TTS Studio extension icon in the toolbar → click **"Read Article"**
- **Option B:** Select some text on the page → right-click → **"Read selection with TTS Studio"**
- **Option C:** Press `Alt+Shift+R` (keyboard shortcut)

### Step 4: Watch for audio playback
- You should hear speech (if Piper is working)
- The popup should show "Playing" status

### Step 5: Watch for highlighting
As each sentence is spoken, you should see:
- **A bright yellow highlight** appear around the sentence on the page
- **Auto-scroll** should keep the highlighted sentence centered on screen
- The highlight should move to the next sentence as TTS progresses

### Step 6: Check the console logs
In the page's DevTools Console, look for:

| Log message | Meaning |
|-------------|---------|
| `[TTS Studio] Highlight applied: Rayleigh quotient...` | ✅ SUCCESS — highlight was registered and should be visible |
| `[TTS Studio] Could not find sentence in page: ...` | ❌ FAIL — text extracted for TTS doesn't match the live DOM text |
| `[TTS Studio] CSS Custom Highlight API not supported` | ❌ FAIL — browser too old (needs Chrome 105+) |

---

## Quick Console Test (Manual)

If TTS audio isn't working but you want to test highlighting independently:

1. Open the **page's** DevTools Console (F12)
2. Paste and run:

```javascript
// Force a test highlight on the first paragraph
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
  acceptNode: n => n.textContent.trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
});
const nodes = [];
let n;
while ((n = walker.nextNode())) nodes.push(n);

// Pick a text node with some content
const target = nodes.find(n => n.textContent.trim().length > 20);
if (target) {
  const range = document.createRange();
  range.setStart(target, 0);
  range.setEnd(target, Math.min(50, target.textContent.length));
  const h = new Highlight(range);
  CSS.highlights.set('tts-sentence', h);
  console.log('Test highlight applied. You should see a yellow box around:', target.textContent.slice(0, 50));
} else {
  console.log('No suitable text node found');
}
```

3. You should see a **bright yellow highlight** appear on the page immediately

---

## Common Issues & Checklist

| Symptom | Likely Cause | Check |
|---------|-------------|-------|
| No highlight, no console logs | Content script not injected | Check `chrome://extensions` → Service Worker → "Inspect" → console for errors |
| "Could not find sentence" | Text sanitization changed whitespace/entities | Compare the log's sentence text with what's actually on the page |
| "Highlight applied" but invisible | CSS overridden by page styles | Try the manual console test above |
| Highlight flickers or jumps | Text spans multiple DOM nodes with weird whitespace | Note the page URL and sentence text for the dev team |
| No audio + no highlight | TTS synthesis failed | Check the popup/offscreen logs for synthesis errors |

---

## Reporting Bugs

If highlighting doesn't work, copy-paste from:
1. **Page URL**
2. **Console logs** (especially any `[TTS Studio]` messages)
3. **What you expected vs what happened**
4. **Screenshots** if possible
