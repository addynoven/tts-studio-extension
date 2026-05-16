/**
 * Sentence-level highlighting via CSS Custom Highlight API.
 *
 * Builds a flat text map of the visible page, finds exact sentence matches,
 * and highlights them using Range + CSS.highlights — no DOM mutations.
 */

// ── Text Map ───────────────────────────────────────────────────────────────

let textMap = null;           // { nodes: TextNode[], offsets: number[], flat: string }
let currentSentenceHighlight = null;
let highlightStyleEl = null;
let lastMatchEnd = 0;         // flat-string index after last highlight

/**
 * Build (or rebuild) the flat text map of the visible page.
 */
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
        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return NodeFilter.FILTER_REJECT;
        }
        // Skip script/style/noscript tags
        const tag = parent.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'iframe', 'canvas'].includes(tag)) {
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

/**
 * Find the first occurrence of `query` in the flat text, starting from `startOffset`.
 * Returns { start, end } indices in the flat string, or null.
 */
function findInFlat(query, startOffset = 0) {
  if (!textMap) return null;
  const idx = textMap.flat.indexOf(query, startOffset);
  if (idx === -1) return null;
  return { start: idx, end: idx + query.length };
}

/**
 * Convert flat-string indices to a Range.
 */
function rangeFromFlatIndices(start, end) {
  if (!textMap) return null;
  const { nodes, offsets } = textMap;

  // Find the text node containing `start`
  let startNode = null;
  let startNodeOffset = 0;
  for (let i = 0; i < offsets.length; i++) {
    const nodeStart = offsets[i];
    const nodeEnd = i + 1 < offsets.length ? offsets[i + 1] : textMap.flat.length;
    if (start >= nodeStart && start < nodeEnd) {
      startNode = nodes[i];
      startNodeOffset = start - nodeStart;
      break;
    }
  }

  // Find the text node containing `end - 1`
  let endNode = null;
  let endNodeOffset = 0;
  for (let i = 0; i < offsets.length; i++) {
    const nodeStart = offsets[i];
    const nodeEnd = i + 1 < offsets.length ? offsets[i + 1] : textMap.flat.length;
    if (end > nodeStart && end <= nodeEnd) {
      endNode = nodes[i];
      endNodeOffset = end - nodeStart;
      break;
    }
  }

  if (!startNode || !endNode) return null;

  const range = document.createRange();
  range.setStart(startNode, startNodeOffset);
  range.setEnd(endNode, endNodeOffset);
  return range;
}

// ── Highlight API ──────────────────────────────────────────────────────────

function ensureStyle() {
  if (highlightStyleEl) return;
  if (!CSS.highlights) {
    console.warn('[TTS Studio] CSS Custom Highlight API not supported');
    return;
  }
  const style = document.createElement('style');
  style.textContent = `
    ::highlight(tts-sentence) {
      background-color: rgba(255, 235, 59, 0.55);
      color: #000;
      border-radius: 3px;
      outline: 1.5px solid rgba(234, 179, 8, 0.7);
      outline-offset: 1px;
    }
    ::highlight(tts-word) {
      background-color: rgba(234, 179, 8, 0.85);
      color: #000;
      border-radius: 2px;
    }
    @media (prefers-color-scheme: dark) {
      ::highlight(tts-sentence) {
        background-color: rgba(251, 191, 36, 0.5);
        color: #fff;
        outline: 1.5px solid rgba(251, 191, 36, 0.8);
      }
      ::highlight(tts-word) {
        background-color: rgba(251, 191, 36, 0.85);
        color: #000;
      }
    }
  `;
  document.head.appendChild(style);
  highlightStyleEl = style;
}

function setSentenceHighlight(range) {
  if (!CSS.highlights) return;
  clearSentenceHighlight();
  const highlight = new Highlight(range);
  CSS.highlights.set('tts-sentence', highlight);
  currentSentenceHighlight = range;
}

function clearSentenceHighlight() {
  if (!CSS.highlights) return;
  CSS.highlights.delete('tts-sentence');
  currentSentenceHighlight = null;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Highlight the exact sentence text on the page.
 * @param {string} chunkText
 */
export function highlightSentence(chunkText) {
  if (!chunkText) return;
  ensureStyle();

  if (!textMap) buildTextMap();
  console.log('[TTS Studio] Highlight search start. Map length:', textMap.flat.length, '| Query:', chunkText.slice(0, 60));

  // Try exact match, starting from after the last highlight (TTS plays in order)
  let match = findInFlat(chunkText, lastMatchEnd);
  console.log('[TTS Studio] Exact match (from', lastMatchEnd, '):', match ? 'found at ' + match.start : 'no match');

  // If no match ahead, wrap around and search from beginning (user may have skipped back)
  if (!match) {
    match = findInFlat(chunkText, 0);
    console.log('[TTS Studio] Exact match (from 0):', match ? 'found at ' + match.start : 'no match');
  }

  // If exact fails, try with normalized whitespace
  if (!match) {
    const normalizedQuery = chunkText.replace(/\s+/g, ' ');
    const normalizedFlat = textMap.flat.replace(/\s+/g, ' ');
    const idx = normalizedFlat.indexOf(normalizedQuery, lastMatchEnd);
    console.log('[TTS Studio] Normalized match (from', lastMatchEnd, '):', idx);
    if (idx !== -1) {
      match = findInFlat(chunkText.trim(), lastMatchEnd);
    }
    if (!match) {
      const idx2 = normalizedFlat.indexOf(normalizedQuery, 0);
      console.log('[TTS Studio] Normalized match (from 0):', idx2);
      if (idx2 !== -1) {
        match = findInFlat(chunkText.trim(), 0);
      }
    }
  }

  // If still no match, try trimming punctuation
  if (!match) {
    const trimmed = chunkText.replace(/^[\s\n]+|[\s\n]+$/g, '');
    match = findInFlat(trimmed, lastMatchEnd);
    if (!match) match = findInFlat(trimmed, 0);
    console.log('[TTS Studio] Trimmed match:', match ? 'found' : 'no match');
  }

  if (!match) {
    console.warn('[TTS Studio] Could not find sentence in page:', chunkText.slice(0, 60));
    return;
  }

  const range = rangeFromFlatIndices(match.start, match.end);
  if (!range) {
    console.warn('[TTS Studio] Could not create range for sentence');
    return;
  }

  setSentenceHighlight(range);
  lastMatchEnd = match.end;
  console.log('[TTS Studio] Highlight applied:', chunkText.slice(0, 60));

  // Auto-scroll
  const rect = range.getBoundingClientRect();
  const margin = 80;
  const visible = rect.top >= margin && rect.bottom <= window.innerHeight - margin;
  if (!visible && rect.height > 0) {
    window.scrollTo({
      top: window.scrollY + rect.top - window.innerHeight / 2 + rect.height / 2,
      behavior: 'smooth'
    });
  }
}

export function clearHighlight() {
  clearSentenceHighlight();
}

export function clearAll() {
  clearSentenceHighlight();
  textMap = null;
  lastMatchEnd = 0;
}
