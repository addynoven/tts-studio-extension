/**
 * Chunk-level highlighting on the webpage.
 *
 * When a TTS chunk starts playing, we receive the chunk text from the offscreen
 * document and highlight the paragraph/element on the page that contains it.
 *
 * This uses fuzzy text matching because the chunk text has been sanitized
 * (URLs removed, markdown stripped, etc.) while the page text is raw.
 */

const HIGHLIGHT_CLASS = 'tts-studio-highlight';
const STYLE_ID = 'tts-studio-chunk-highlight-styles';

let currentHighlightEl = null;
let highlightStyleEl = null;

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

// ── Chunk highlighting ──────────────────────────────────────────────────────

/**
 * Highlight the element on the page that best matches the given chunk text.
 * @param {string} chunkText — the text of the currently-playing chunk
 */
export function highlightChunk(chunkText) {
  if (!chunkText) return;
  injectStyles();

  // Clear previous highlight
  clearHighlight();

  // Find the best matching element
  const el = findBestMatchingElement(chunkText);
  if (!el) {
    console.warn('[TTS Studio] Could not find element for chunk:', chunkText.slice(0, 60));
    return;
  }

  el.classList.add(HIGHLIGHT_CLASS);
  currentHighlightEl = el;

  // Smooth scroll into view (only if not already visible)
  const rect = el.getBoundingClientRect();
  const isVisible = rect.top >= 80 && rect.bottom <= window.innerHeight - 80;
  if (!isVisible) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/**
 * Clear the current highlight.
 */
export function clearHighlight() {
  if (currentHighlightEl) {
    currentHighlightEl.classList.remove(HIGHLIGHT_CLASS);
    currentHighlightEl = null;
  }
}

/**
 * Clear all highlights and remove injected styles.
 */
export function clearAll() {
  clearHighlight();
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(el => {
    el.classList.remove(HIGHLIGHT_CLASS);
  });
}

// ── Text matching ───────────────────────────────────────────────────────────

const CANDIDATE_SELECTORS = [
  'p',
  'article p',
  '.article-body p',
  '[class*="content"] p',
  'div[class*="text"]',
  'section p',
  'main p',
  'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote',
  'td',
  'div' // fallback
];

/**
 * Find the element on the page that best matches the chunk text.
 * Uses a multi-strategy approach for robustness.
 */
function findBestMatchingElement(chunkText) {
  const normalizedChunk = normalizeText(chunkText);
  const chunkWords = getSignificantWords(normalizedChunk);

  if (chunkWords.length === 0) return null;

  const candidates = document.querySelectorAll(CANDIDATE_SELECTORS.join(', '));
  let bestEl = null;
  let bestScore = -1;

  for (const el of candidates) {
    // Skip invisible elements
    if (!isVisible(el)) continue;

    const elText = normalizeText(el.textContent || '');
    if (elText.length < 10) continue; // Skip very short elements

    const score = computeMatchScore(chunkWords, elText);
    if (score > bestScore) {
      bestScore = score;
      bestEl = el;
    }
  }

  // Require a minimum quality match
  if (bestScore < 0.3) return null;

  return bestEl;
}

/**
 * Compute how well a chunk matches an element's text.
 * Returns a score from 0 to 1.
 */
function computeMatchScore(chunkWords, elementText) {
  // Strategy 1: direct substring match (highest score)
  const chunkJoined = chunkWords.join(' ');
  if (elementText.includes(chunkJoined)) {
    return 1.0;
  }

  // Strategy 2: find how many chunk words appear in the element
  let matchedWords = 0;
  for (const word of chunkWords) {
    if (elementText.includes(word)) {
      matchedWords++;
    }
  }
  const wordCoverage = matchedWords / chunkWords.length;

  // Strategy 3: check if element text is a substring of the chunk (reverse)
  const elementWords = getSignificantWords(elementText);
  let reverseMatched = 0;
  for (const word of elementWords) {
    if (chunkJoined.includes(word)) {
      reverseMatched++;
    }
  }
  const reverseCoverage = elementWords.length > 0 ? reverseMatched / elementWords.length : 0;

  // Combine: prefer cases where most chunk words are found in the element
  return wordCoverage * 0.7 + reverseCoverage * 0.3;
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
  // Extract words of 3+ characters for matching
  // (skip "the", "and", "a", etc. which create false matches)
  const words = text.split(/\s+/).filter(w => w.length >= 3);
  // If no long words, fall back to all words
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
