/**
 * Word-level highlighting on the webpage.
 *
 * Wraps individual words in <span> elements and toggles a CSS class
 * as the TTS engine speaks them. Uses requestAnimationFrame for
 * tight sync with audio playback.
 */

const HIGHLIGHT_CLASS = 'tts-studio-word-highlight';
const STYLE_ID = 'tts-studio-word-highlight-styles';

let activeSpans = [];
let highlightTimeout = null;
let isHighlighting = false;

// ── Style injection ─────────────────────────────────────────────────────────

export function injectWordStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      background-color: #ffeb3b !important;
      color: #000 !important;
      border-radius: 2px !important;
      transition: background-color 0.05s ease !important;
      box-shadow: 0 0 0 1px rgba(255, 235, 59, 0.5) !important;
    }
    @media (prefers-color-scheme: dark) {
      .${HIGHLIGHT_CLASS} {
        background-color: #fbbf24 !important;
        color: #000 !important;
      }
    }
  `;
  document.head.appendChild(style);
}

export function removeWordStyles() {
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}

// ── Highlighting ────────────────────────────────────────────────────────────

/**
 * Start highlighting words based on timing data.
 * @param {WordEntry[]} wordMap
 * @param {number[]} startTimes — start time in ms for each word
 * @param {number} baseTime — performance.now() when chunk started playing
 */
export function startHighlighting(wordMap, startTimes, baseTime) {
  stopHighlighting();
  isHighlighting = true;
  injectWordStyles();

  let currentIndex = -1;

  function tick() {
    if (!isHighlighting) return;

    const elapsed = performance.now() - baseTime;

    // Find which word should be highlighted now
    let nextIndex = currentIndex;
    for (let i = currentIndex + 1; i < startTimes.length; i++) {
      if (elapsed >= startTimes[i]) {
        nextIndex = i;
      } else {
        break;
      }
    }

    if (nextIndex !== currentIndex && nextIndex >= 0) {
      highlightWord(wordMap, nextIndex);
      currentIndex = nextIndex;
    }

    // Continue until last word
    if (currentIndex < startTimes.length - 1) {
      requestAnimationFrame(tick);
    }
  }

  requestAnimationFrame(tick);
}

/**
 * Highlight a single word by index.
 */
export function highlightWord(wordMap, index) {
  // Remove previous highlight
  clearActiveHighlights();

  const entry = wordMap[index];
  if (!entry) return;

  const span = wrapWordInSpan(entry);
  if (span) {
    span.classList.add(HIGHLIGHT_CLASS);
    activeSpans.push(span);

    // Auto-scroll if near bottom of viewport
    const rect = span.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 100 || rect.top < 100) {
      span.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

/**
 * Stop all highlighting and clean up.
 */
export function stopHighlighting() {
  isHighlighting = false;
  if (highlightTimeout) {
    clearTimeout(highlightTimeout);
    highlightTimeout = null;
  }
  clearActiveHighlights();
}

/**
 * Remove highlight from all active spans, but keep the spans
 * (they'll be cleaned up by clearAllWordSpans).
 */
function clearActiveHighlights() {
  for (const span of activeSpans) {
    if (span.parentNode) {
      span.classList.remove(HIGHLIGHT_CLASS);
    }
  }
  activeSpans = [];
}

/**
 * Remove ALL highlight spans from the page and restore original text nodes.
 * Call this when TTS stops or page navigation occurs.
 */
export function clearAllWordSpans() {
  stopHighlighting();

  const spans = document.querySelectorAll(`span.${HIGHLIGHT_CLASS}`);
  for (const span of spans) {
    unwrapSpan(span);
  }

  // Also clear any leftover spans that may have lost their class
  const allSpans = document.querySelectorAll(`span[data-tts-word]`);
  for (const span of allSpans) {
    unwrapSpan(span);
  }
}

// ── DOM manipulation ────────────────────────────────────────────────────────

/**
 * Wrap a word (defined by a WordEntry) in a <span>.
 * Returns the span element.
 */
function wrapWordInSpan(entry) {
  // If already wrapped, reuse
  const parent = entry.textNode.parentElement;
  if (parent && parent.dataset && parent.dataset.ttsWord === String(entry.index)) {
    return parent;
  }

  const range = document.createRange();
  range.setStart(entry.textNode, entry.startOffset);
  range.setEnd(entry.textNode, entry.endOffset);

  try {
    const span = document.createElement('span');
    span.dataset.ttsWord = String(entry.index);
    range.surroundContents(span);
    return span;
  } catch (e) {
    // Partial selection across elements — fallback to simple text replacement
    // This shouldn't happen with our word indexer since we operate on single text nodes
    console.warn('[TTS Studio] Could not wrap word:', entry.word, e);
    return null;
  }
}

/**
 * Unwrap a span — replace it with its textContent.
 */
function unwrapSpan(span) {
  const parent = span.parentNode;
  if (!parent) return;

  const text = document.createTextNode(span.textContent);
  parent.insertBefore(text, span);
  parent.removeChild(span);

  // Normalize adjacent text nodes
  parent.normalize();
}
