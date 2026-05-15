/**
 * Chunk-level highlighting on the webpage.
 *
 * When a TTS chunk starts playing, we receive the chunk text from the offscreen
 * document and highlight the paragraph/element on the page that contains it.
 *
 * Uses pre-indexing + sequential search for accurate, fast matching.
 */

const HIGHLIGHT_CLASS = 'tts-studio-highlight';
const STYLE_ID = 'tts-studio-chunk-highlight-styles';

let currentHighlightEl = null;
let highlightStyleEl = null;

// ── Pre-indexed page state ─────────────────────────────────────────────────

let pageIndex = [];       // [{ el, normalizedText }, ...] in DOM order
let lastMatchIndex = -1;  // index in pageIndex of last highlighted element
let indexBuilt = false;

// ── Style injection ─────────────────────────────────────────────────────────

export function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      background-color: rgba(255, 235, 59, 0.45) !important;
      color: inherit !important;
      border-radius: 3px !important;
      transition: background-color 0.15s ease !important;
      box-shadow: 0 0 0 1px rgba(255, 235, 59, 0.3) !important;
    }
    @media (prefers-color-scheme: dark) {
      .${HIGHLIGHT_CLASS} {
        background-color: rgba(251, 191, 36, 0.35) !important;
        box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.25) !important;
      }
    }
  `;
  document.head.appendChild(style);
  highlightStyleEl = style;
}

export function removeStyles() {
  if (highlightStyleEl) {
    highlightStyleEl.remove();
    highlightStyleEl = null;
  }
}

// ── Index building ──────────────────────────────────────────────────────────

const CANDIDATE_SELECTORS = [
  'p', 'article p', '.article-body p', '[class*="content"] p',
  'div[class*="text"]', 'section p', 'main p', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'td', 'div'
];

function buildPageIndex() {
  if (indexBuilt) return;
  pageIndex = [];
  const candidates = document.querySelectorAll(CANDIDATE_SELECTORS.join(', '));
  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const text = el.textContent || '';
    if (text.length < 10) continue;
    pageIndex.push({ el, text, normalized: normalizeText(text) });
  }
  indexBuilt = true;
  lastMatchIndex = -1;
}

// ── Chunk highlighting ──────────────────────────────────────────────────────

/**
 * Highlight the element on the page that best matches the given chunk text.
 * @param {string} chunkText — the text of the currently-playing chunk
 */
export function highlightChunk(chunkText) {
  if (!chunkText) return;
  injectStyles();
  buildPageIndex();
  clearHighlight();

  const el = findSequentialMatch(chunkText);
  if (!el) {
    console.warn('[TTS Studio] Could not find element for chunk:', chunkText.slice(0, 60));
    return;
  }

  el.classList.add(HIGHLIGHT_CLASS);
  currentHighlightEl = el;

  const rect = el.getBoundingClientRect();
  const isVisible = rect.top >= 80 && rect.bottom <= window.innerHeight - 80;
  if (!isVisible) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/**
 * Find the best match, searching sequentially from the last match.
 * Strategy: substring match first, then fuzzy word match.
 */
function findSequentialMatch(chunkText) {
  const normalizedChunk = normalizeText(chunkText);
  if (!normalizedChunk) return null;

  // Start searching from just after the last match (TTS plays in order)
  const startIdx = Math.max(0, lastMatchIndex);

  // ── Phase 1: Substring match ────────────────────────────────────────────
  for (let i = startIdx; i < pageIndex.length; i++) {
    const entry = pageIndex[i];
    if (entry.normalized.includes(normalizedChunk)) {
      lastMatchIndex = i;
      return entry.el;
    }
  }
  // Fallback: search from beginning (in case user jumped back)
  for (let i = 0; i < startIdx; i++) {
    const entry = pageIndex[i];
    if (entry.normalized.includes(normalizedChunk)) {
      lastMatchIndex = i;
      return entry.el;
    }
  }

  // ── Phase 2: Fuzzy word match ───────────────────────────────────────────
  const chunkWords = getSignificantWords(normalizedChunk);
  if (chunkWords.length === 0) return null;

  let bestEl = null;
  let bestScore = -1;
  let bestIdx = -1;

  for (let i = startIdx; i < pageIndex.length; i++) {
    const score = computeMatchScore(chunkWords, pageIndex[i].normalized);
    if (score > bestScore) {
      bestScore = score;
      bestEl = pageIndex[i].el;
      bestIdx = i;
    }
  }

  if (bestScore >= 0.5) {
    lastMatchIndex = bestIdx;
    return bestEl;
  }

  return null;
}

/**
 * Compute how well a chunk matches an element's text.
 * Returns a score from 0 to 1.
 */
function computeMatchScore(chunkWords, elementText) {
  const chunkJoined = chunkWords.join(' ');

  // How many chunk words appear in the element
  let matchedWords = 0;
  for (const word of chunkWords) {
    if (elementText.includes(word)) matchedWords++;
  }
  const wordCoverage = matchedWords / chunkWords.length;

  // Reverse: how many element words appear in the chunk
  const elementWords = getSignificantWords(elementText);
  let reverseMatched = 0;
  for (const word of elementWords) {
    if (chunkJoined.includes(word)) reverseMatched++;
  }
  const reverseCoverage = elementWords.length > 0 ? reverseMatched / elementWords.length : 0;

  return wordCoverage * 0.7 + reverseCoverage * 0.3;
}

// ── Clear ───────────────────────────────────────────────────────────────────

export function clearHighlight() {
  if (currentHighlightEl) {
    currentHighlightEl.classList.remove(HIGHLIGHT_CLASS);
    currentHighlightEl = null;
  }
}

export function clearAll() {
  clearHighlight();
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(el => {
    el.classList.remove(HIGHLIGHT_CLASS);
  });
  pageIndex = [];
  indexBuilt = false;
  lastMatchIndex = -1;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

function getSignificantWords(text) {
  const words = text.split(/\s+/).filter(w => w.length >= 3);
  return words.length > 0 ? words : text.split(/\s+/).filter(w => w.length > 0);
}

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && style.opacity !== '0'
    && el.offsetParent !== null;
}
