/**
 * Sentence-level highlighting on the webpage.
 *
 * Strategy:
 *  1. Build a flat text map of the page via TreeWalker (once).
 *  2. Find the chunk text in the flat string → create a Range.
 *  3. Try CSS Custom Highlight API (::highlight) — zero DOM mutations.
 *  4. If CSS.highlights fails or is unavailable, fall back to wrapping
 *     the closest block element with a CSS class.
 */

const HIGHLIGHT_CLASS = 'tts-studio-highlight';
const STYLE_ID = 'tts-studio-highlight-styles';

// ── State ──────────────────────────────────────────────────────────────────

let textMap = null;          // { nodes[], offsets[], flat }
let lastMatchEnd = 0;
let highlightStyleEl = null;
let currentHighlightEl = null;
let currentRange = null;
let useCSSHighlights = false; // determined at runtime

// ── Style injection ────────────────────────────────────────────────────────

function ensureStyles() {
  if (highlightStyleEl) return;

  // Test if CSS.highlights actually works by setting and reading back
  useCSSHighlights = false;
  if (typeof CSS !== 'undefined' && CSS.highlights) {
    try {
      const testRange = document.createRange();
      testRange.selectNodeContents(document.body);
      const testHL = new Highlight(testRange);
      CSS.highlights.set('tts-test', testHL);
      CSS.highlights.delete('tts-test');
      useCSSHighlights = true;
    } catch {
      useCSSHighlights = false;
    }
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;

  if (useCSSHighlights) {
    style.textContent = `
      ::highlight(tts-sentence) {
        background-color: rgba(255, 235, 59, 0.55);
        color: #000;
        border-radius: 3px;
        outline: 1.5px solid rgba(234, 179, 8, 0.7);
        outline-offset: 1px;
      }
      @media (prefers-color-scheme: dark) {
        ::highlight(tts-sentence) {
          background-color: rgba(251, 191, 36, 0.5);
          color: #fff;
          outline: 1.5px solid rgba(251, 191, 36, 0.8);
        }
      }
    `;
  } else {
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
  }

  document.head.appendChild(style);
  highlightStyleEl = style;
  console.log('[TTS Highlighter] Mode:', useCSSHighlights ? 'CSS Highlight API' : 'class-based fallback');
}

// ── Text Map ───────────────────────────────────────────────────────────────

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
        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
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

// ── Normalize for matching ─────────────────────────────────────────────────

function norm(text) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Find `query` in the flat text, with progressive normalization.
 * Returns { start, end } in the ORIGINAL flat string, or null.
 */
function findChunk(query) {
  if (!textMap || !query) return null;
  const flat = textMap.flat;

  // 1. Exact match (from last position, then from 0)
  let idx = flat.indexOf(query, lastMatchEnd);
  if (idx === -1) idx = flat.indexOf(query, 0);
  if (idx !== -1) return { start: idx, end: idx + query.length };

  // 2. Trimmed match
  const trimmed = query.trim();
  idx = flat.indexOf(trimmed, lastMatchEnd);
  if (idx === -1) idx = flat.indexOf(trimmed, 0);
  if (idx !== -1) return { start: idx, end: idx + trimmed.length };

  // 3. Normalized whitespace match — search in normalized flat, map back to original
  const normQuery = norm(query);
  if (!normQuery) return null;

  // Build a mapping from normalized positions to original positions
  const normFlat = norm(flat);
  let normIdx = normFlat.indexOf(normQuery, 0);
  if (normIdx === -1) return null;

  // Map normalized index back to original: walk both strings in parallel
  let origIdx = 0;
  let nIdx = 0;
  const origLower = flat.toLowerCase();

  // Skip leading whitespace in flat to align with normFlat
  while (origIdx < flat.length && /\s/.test(flat[origIdx])) origIdx++;

  // Walk through normFlat to find where normIdx maps in original
  for (let ni = 0; ni < normIdx; ni++) {
    if (normFlat[ni] === ' ') {
      // Skip whitespace in original
      while (origIdx < flat.length && /\s/.test(flat[origIdx])) origIdx++;
    } else {
      origIdx++;
      // Skip extra whitespace in original
      while (origIdx < flat.length && /\s/.test(flat[origIdx]) && (ni + 1 >= normFlat.length || normFlat[ni + 1] !== ' ')) {
        origIdx++;
      }
    }
  }

  // Now find the end: walk normQuery.length chars
  let origEnd = origIdx;
  for (let ni = 0; ni < normQuery.length; ni++) {
    if (normQuery[ni] === ' ') {
      while (origEnd < flat.length && /\s/.test(flat[origEnd])) origEnd++;
    } else {
      origEnd++;
      while (origEnd < flat.length && /\s/.test(flat[origEnd]) && (ni + 1 >= normQuery.length || normQuery[ni + 1] !== ' ')) {
        origEnd++;
      }
    }
  }

  if (origIdx < flat.length) {
    return { start: origIdx, end: Math.min(origEnd, flat.length) };
  }

  return null;
}

// ── Range creation ─────────────────────────────────────────────────────────

function rangeFromFlatIndices(start, end) {
  if (!textMap) return null;
  const { nodes, offsets } = textMap;

  let startNode = null, startOff = 0;
  let endNode = null, endOff = 0;

  for (let i = 0; i < offsets.length; i++) {
    const nodeStart = offsets[i];
    const nodeEnd = i + 1 < offsets.length ? offsets[i + 1] : textMap.flat.length;

    if (!startNode && start >= nodeStart && start < nodeEnd) {
      startNode = nodes[i];
      startOff = start - nodeStart;
    }
    if (end > nodeStart && end <= nodeEnd) {
      endNode = nodes[i];
      endOff = end - nodeStart;
    }
  }

  if (!startNode || !endNode) return null;

  try {
    const range = document.createRange();
    range.setStart(startNode, startOff);
    range.setEnd(endNode, endOff);
    return range;
  } catch {
    return null;
  }
}

// ── Find the closest block-level ancestor ──────────────────────────────────

function getBlockAncestor(node) {
  const BLOCK_TAGS = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'BLOCKQUOTE', 'TD', 'TH', 'DIV', 'SECTION', 'ARTICLE', 'MAIN']);
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (el && el !== document.body) {
    if (BLOCK_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return null;
}

// ── Apply / clear highlight ────────────────────────────────────────────────

function applyHighlight(range) {
  clearHighlightInternal();

  if (useCSSHighlights) {
    try {
      const hl = new Highlight(range);
      CSS.highlights.set('tts-sentence', hl);
      currentRange = range;
    } catch (e) {
      console.warn('[TTS Highlighter] CSS Highlight failed, using class fallback:', e.message);
      applyClassFallback(range);
    }
  } else {
    applyClassFallback(range);
  }
}

function applyClassFallback(range) {
  // Highlight the block element containing the start of the range
  const blockEl = getBlockAncestor(range.startContainer);
  if (blockEl) {
    blockEl.classList.add(HIGHLIGHT_CLASS);
    currentHighlightEl = blockEl;
  }
}

function clearHighlightInternal() {
  // Clear CSS Highlight API
  if (typeof CSS !== 'undefined' && CSS.highlights) {
    try { CSS.highlights.delete('tts-sentence'); } catch {}
  }
  currentRange = null;

  // Clear class-based fallback
  if (currentHighlightEl) {
    currentHighlightEl.classList.remove(HIGHLIGHT_CLASS);
    currentHighlightEl = null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Highlight the sentence on the page that matches the chunk text.
 */
export function highlightSentence(chunkText) {
  if (!chunkText) return;
  ensureStyles();
  if (!textMap) buildTextMap();

  const match = findChunk(chunkText);

  if (!match) {
    // Last resort: find a block element whose text contains the chunk
    console.warn('[TTS Highlighter] No text match, trying element search for:', chunkText.slice(0, 60));
    clearHighlightInternal();
    const normChunk = norm(chunkText);
    for (let i = 0; i < textMap.nodes.length; i++) {
      const blockEl = getBlockAncestor(textMap.nodes[i]);
      if (blockEl && norm(blockEl.textContent).includes(normChunk)) {
        blockEl.classList.add(HIGHLIGHT_CLASS);
        currentHighlightEl = blockEl;
        scrollIntoViewIfNeeded(blockEl);
        return;
      }
    }
    console.warn('[TTS Highlighter] Could not find any match for:', chunkText.slice(0, 60));
    return;
  }

  const range = rangeFromFlatIndices(match.start, match.end);
  if (!range) {
    console.warn('[TTS Highlighter] Could not create range');
    return;
  }

  applyHighlight(range);
  lastMatchEnd = match.end;

  // Auto-scroll
  scrollIntoViewIfNeeded(range);
}

function scrollIntoViewIfNeeded(target) {
  const rect = target instanceof Range ? target.getBoundingClientRect() :
    target.getBoundingClientRect();
  const margin = 80;
  const visible = rect.top >= margin && rect.bottom <= window.innerHeight - margin;
  if (!visible && rect.height > 0) {
    if (target instanceof Range) {
      window.scrollTo({
        top: window.scrollY + rect.top - window.innerHeight / 2 + rect.height / 2,
        behavior: 'smooth'
      });
    } else {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

export function clearHighlight() {
  clearHighlightInternal();
}

export function clearAll() {
  clearHighlightInternal();
  textMap = null;
  lastMatchEnd = 0;
}
