/**
 * Sentence & element-level highlighting on the webpage.
 *
 * Two modes:
 *  1. Mapped mode: We have a direct DOM element reference from extraction.
 *     Just add a class to the element. 100% accurate.
 *  2. Text-search mode: We search for chunk text in the page.
 *     Uses CSS Highlight API if available, class-based fallback otherwise.
 */

const HIGHLIGHT_CLASS = 'tts-studio-highlight';
const ACTIVE_CLASS = 'tts-studio-active';
const STYLE_ID = 'tts-studio-highlight-styles';

// ── State ──────────────────────────────────────────────────────────────────

let highlightStyleEl = null;
let currentHighlightEl = null;
let currentRange = null;

// Mapped blocks from DOM extraction (set by content/index.js)
let mappedBlocks = null;

// Text-search state
let textMap = null;
let lastMatchEnd = 0;

// ── Style injection ────────────────────────────────────────────────────────

function ensureStyles() {
  if (highlightStyleEl) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      background-color: rgba(255, 235, 59, 0.45) !important;
      color: inherit !important;
      border-radius: 3px !important;
      transition: background-color 0.2s ease !important;
      box-shadow: 0 0 0 2px rgba(255, 235, 59, 0.3) !important;
    }
    .${ACTIVE_CLASS} {
      background-color: rgba(255, 235, 59, 0.6) !important;
      box-shadow: 0 0 0 2px rgba(234, 179, 8, 0.5) !important;
    }
    @media (prefers-color-scheme: dark) {
      .${HIGHLIGHT_CLASS} {
        background-color: rgba(251, 191, 36, 0.35) !important;
        box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.25) !important;
      }
      .${ACTIVE_CLASS} {
        background-color: rgba(251, 191, 36, 0.55) !important;
        box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.5) !important;
      }
    }
  `;
  document.head.appendChild(style);
  highlightStyleEl = style;
}

// ── Mapped block store ─────────────────────────────────────────────────────

/**
 * Store mapped blocks from DOM extraction.
 * @param {Array<{ el: Element, rawText: string, ttsText: string }>} blocks
 */
export function setMappedBlocks(blocks) {
  mappedBlocks = blocks;
  console.log('[TTS Highlighter] Stored', blocks.length, 'mapped blocks');
}

// ── Highlight by chunk index (mapped mode) ─────────────────────────────────

/**
 * Highlight by block index. Uses direct element reference — always accurate.
 * @param {number} blockIndex - Index into the mapped blocks array
 */
export function highlightByIndex(blockIndex) {
  ensureStyles();
  clearHighlightInternal();

  if (!mappedBlocks || blockIndex < 0 || blockIndex >= mappedBlocks.length) {
    console.warn('[TTS Highlighter] Invalid block index:', blockIndex, '/', mappedBlocks?.length);
    return;
  }

  const block = mappedBlocks[blockIndex];
  if (!block?.el) return;

  block.el.classList.add(HIGHLIGHT_CLASS);
  currentHighlightEl = block.el;
  scrollIntoViewIfNeeded(block.el);
}

// ── Highlight by text (text-search mode, for popup flow) ───────────────────

/**
 * Highlight by matching chunk text in the page DOM.
 * Used when we don't have mapped blocks (e.g., popup paste flow).
 */
export function highlightSentence(chunkText) {
  if (!chunkText) return;
  ensureStyles();
  clearHighlightInternal();

  // Try mapped mode first: search blocks for matching text
  if (mappedBlocks) {
    const normChunk = norm(chunkText);
    for (let i = 0; i < mappedBlocks.length; i++) {
      const block = mappedBlocks[i];
      if (norm(block.ttsText) === normChunk || norm(block.rawText).includes(normChunk)) {
        block.el.classList.add(HIGHLIGHT_CLASS);
        currentHighlightEl = block.el;
        scrollIntoViewIfNeeded(block.el);
        return;
      }
    }
  }

  // Fall back to text map search
  if (!textMap) buildTextMap();

  const match = findChunk(chunkText);
  if (match) {
    const blockEl = findBlockAncestor(match.start);
    if (blockEl) {
      blockEl.classList.add(HIGHLIGHT_CLASS);
      currentHighlightEl = blockEl;
      lastMatchEnd = match.end;
      scrollIntoViewIfNeeded(blockEl);
      return;
    }
  }

  // Last resort: find element containing the text
  const normChunk = norm(chunkText);
  const candidates = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, td');
  for (const el of candidates) {
    if (norm(el.textContent).includes(normChunk)) {
      el.classList.add(HIGHLIGHT_CLASS);
      currentHighlightEl = el;
      scrollIntoViewIfNeeded(el);
      return;
    }
  }

  console.warn('[TTS Highlighter] No match for:', chunkText.slice(0, 60));
}

// ── Text map for fallback search ───────────────────────────────────────────

function buildTextMap() {
  const nodes = [];
  const offsets = [];
  let flat = '';

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'iframe', 'canvas', 'svg'].includes(tag)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!node.textContent || node.textContent.trim().length === 0) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node;
  while ((node = walker.nextNode())) {
    offsets.push(flat.length);
    nodes.push(node);
    flat += node.textContent;
  }

  textMap = { nodes, offsets, flat };
}

function findChunk(query) {
  if (!textMap) return null;
  const flat = textMap.flat;

  // Exact match
  let idx = flat.indexOf(query, lastMatchEnd);
  if (idx === -1) idx = flat.indexOf(query, 0);
  if (idx !== -1) return { start: idx, end: idx + query.length };

  // Trimmed
  const trimmed = query.trim();
  idx = flat.indexOf(trimmed, lastMatchEnd);
  if (idx === -1) idx = flat.indexOf(trimmed, 0);
  if (idx !== -1) return { start: idx, end: idx + trimmed.length };

  return null;
}

function findBlockAncestor(flatIndex) {
  if (!textMap) return null;
  const BLOCKS = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'BLOCKQUOTE', 'TD', 'TH', 'DIV', 'SECTION', 'ARTICLE']);

  // Find the text node at this flat index
  for (let i = 0; i < textMap.offsets.length; i++) {
    const nodeStart = textMap.offsets[i];
    const nodeEnd = i + 1 < textMap.offsets.length ? textMap.offsets[i + 1] : textMap.flat.length;
    if (flatIndex >= nodeStart && flatIndex < nodeEnd) {
      let el = textMap.nodes[i].parentElement;
      while (el && el !== document.body) {
        if (BLOCKS.has(el.tagName)) return el;
        el = el.parentElement;
      }
      return null;
    }
  }
  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function norm(text) {
  return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function clearHighlightInternal() {
  if (currentHighlightEl) {
    currentHighlightEl.classList.remove(HIGHLIGHT_CLASS, ACTIVE_CLASS);
    currentHighlightEl = null;
  }
  // Also clear any stale highlights
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(el => {
    el.classList.remove(HIGHLIGHT_CLASS, ACTIVE_CLASS);
  });
  currentRange = null;
}

function scrollIntoViewIfNeeded(el) {
  const rect = el.getBoundingClientRect();
  const margin = 80;
  const visible = rect.top >= margin && rect.bottom <= window.innerHeight - margin;
  if (!visible && rect.height > 0) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ── Streaming mode: highlight a specific element directly ──────────────────

/**
 * Highlight a specific DOM element directly.
 * Used in streaming mode where the caller already has the element reference.
 * @param {Element} el
 */
export function highlightElement(el) {
  if (!el) return;
  ensureStyles();
  clearHighlightInternal();
  el.classList.add(HIGHLIGHT_CLASS);
  currentHighlightEl = el;
  scrollIntoViewIfNeeded(el);
}

// ── Public clear ───────────────────────────────────────────────────────────

export function clearHighlight() {
  clearHighlightInternal();
}

export function clearAll() {
  clearHighlightInternal();
  mappedBlocks = null;
  textMap = null;
  lastMatchEnd = 0;
}
