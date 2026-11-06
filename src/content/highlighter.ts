/**
 * Sentence & element-level highlighting on the webpage.
 * Supports modern CSS Custom Highlight API (Chrome 105+) with non-destructive
 * Range objects, falling back to class-based styling.
 */

const HIGHLIGHT_CLASS = 'tts-studio-highlight';
const ACTIVE_CLASS = 'tts-studio-active';
const STYLE_ID = 'tts-studio-highlight-styles';
const CSS_HIGHLIGHT_NAME = 'tts-active';
const CSS_WORD_HIGHLIGHT_NAME = 'tts-word';

export interface MappedBlock {
  el: Element;
  rawText: string;
  ttsText: string;
}

interface TextMap {
  nodes: Text[];
  offsets: number[];
  flat: string;
}

let highlightStyleEl: HTMLStyleElement | null = null;
let currentHighlightEl: Element | null = null;
let _currentRange: Range | null = null;
let mappedBlocks: MappedBlock[] | null = null;
let textMap: TextMap | null = null;
let lastMatchEnd = 0;
let currentSentenceStart = 0;

function supportsCssHighlights(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

function ensureStyles(): void {
  if (highlightStyleEl) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    ::highlight(${CSS_HIGHLIGHT_NAME}) {
      background-color: rgba(255, 235, 59, 0.35);
      color: inherit;
    }
    ::highlight(${CSS_WORD_HIGHLIGHT_NAME}) {
      background-color: rgba(59, 130, 246, 0.45);
      color: inherit;
      border-radius: 2px;
    }
    .${HIGHLIGHT_CLASS} {
      background-color: rgba(255, 235, 59, 0.35) !important;
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
      ::highlight(${CSS_HIGHLIGHT_NAME}) {
        background-color: rgba(251, 191, 36, 0.28);
      }
      ::highlight(${CSS_WORD_HIGHLIGHT_NAME}) {
        background-color: rgba(96, 165, 250, 0.5);
      }
      .${HIGHLIGHT_CLASS} {
        background-color: rgba(251, 191, 36, 0.28) !important;
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

export function setMappedBlocks(blocks: MappedBlock[]): void {
  mappedBlocks = blocks;
}

export function highlightByIndex(blockIndex: number): void {
  ensureStyles();
  clearHighlightInternal();

  if (!mappedBlocks || blockIndex < 0 || blockIndex >= mappedBlocks.length) {
    return;
  }

  const block = mappedBlocks[blockIndex];
  if (!block?.el) return;

  applyHighlightToElement(block.el);
}

export function highlightSentence(chunkText: string): void {
  if (!chunkText) return;
  ensureStyles();
  clearHighlightInternal();

  if (mappedBlocks) {
    const normChunk = norm(chunkText);
    for (let i = 0; i < mappedBlocks.length; i++) {
      const block = mappedBlocks[i];
      if (norm(block.ttsText) === normChunk || norm(block.rawText).includes(normChunk)) {
        applyHighlightToElement(block.el);
        return;
      }
    }
  }

  if (!textMap) buildTextMap();

  const match = findChunk(chunkText);
  if (match) {
    currentSentenceStart = match.start;
    const range = createRangeFromOffsets(match.start, match.end);
    if (range) {
      applyHighlightRange(range);
      lastMatchEnd = match.end;
      return;
    }

    const blockEl = findBlockAncestor(match.start);
    if (blockEl) {
      applyHighlightToElement(blockEl);
      lastMatchEnd = match.end;
      return;
    }
  }

  const normChunk = norm(chunkText);
  const candidates = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, td');
  for (const el of Array.from(candidates)) {
    if (norm(el.textContent || '').includes(normChunk)) {
      applyHighlightToElement(el);
      return;
    }
  }
}

export function highlightElement(el: Element): void {
  if (!el) return;
  ensureStyles();
  clearHighlightInternal();
  applyHighlightToElement(el);
}

function applyHighlightToElement(el: Element): void {
  if (supportsCssHighlights()) {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      CSS.highlights.set(CSS_HIGHLIGHT_NAME, new Highlight(range));
      _currentRange = range;
    } catch {
      // Fallback
      el.classList.add(HIGHLIGHT_CLASS);
    }
  } else {
    el.classList.add(HIGHLIGHT_CLASS);
  }

  currentHighlightEl = el;
  scrollIntoViewIfNeeded(el);
}

function applyHighlightRange(range: Range): void {
  _currentRange = range;
  if (supportsCssHighlights()) {
    try {
      CSS.highlights.set(CSS_HIGHLIGHT_NAME, new Highlight(range));
    } catch {
      const parent = range.commonAncestorContainer.parentElement;
      if (parent) parent.classList.add(HIGHLIGHT_CLASS);
    }
  } else {
    const parent = range.commonAncestorContainer.parentElement;
    if (parent) parent.classList.add(HIGHLIGHT_CLASS);
  }

  if (typeof range.getBoundingClientRect === 'function') {
    const rect = range.getBoundingClientRect();
    if (rect && (rect.top < 80 || rect.bottom > window.innerHeight - 80)) {
      const node = range.commonAncestorContainer;
      const el = node instanceof Element ? node : node.parentElement;
      if (el) scrollIntoViewIfNeeded(el);
    }
  } else {
    const node = range.commonAncestorContainer;
    const el = node instanceof Element ? node : node.parentElement;
    if (el) scrollIntoViewIfNeeded(el);
  }
}

function createRangeFromOffsets(start: number, end: number): Range | null {
  if (!textMap) return null;
  const { nodes, offsets } = textMap;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (let i = 0; i < offsets.length; i++) {
    const s = offsets[i];
    const e = i + 1 < offsets.length ? offsets[i + 1] : textMap.flat.length;
    if (!startNode && start >= s && start < e) {
      startNode = nodes[i];
      startOffset = start - s;
    }
    if (end > s && end <= e) {
      endNode = nodes[i];
      endOffset = end - s;
      break;
    }
  }

  if (startNode && endNode) {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  }
  return null;
}

function buildTextMap(): void {
  const nodes: Text[] = [];
  const offsets: number[] = [];
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

  let node: Node | null;
  while ((node = walker.nextNode())) {
    offsets.push(flat.length);
    nodes.push(node as Text);
    flat += node.textContent || '';
  }

  textMap = { nodes, offsets, flat };
}

function findChunk(query: string): { start: number; end: number } | null {
  if (!textMap) return null;
  const flat = textMap.flat;

  let idx = flat.indexOf(query, lastMatchEnd);
  if (idx === -1) idx = flat.indexOf(query, 0);
  if (idx !== -1) return { start: idx, end: idx + query.length };

  const trimmed = query.trim();
  idx = flat.indexOf(trimmed, lastMatchEnd);
  if (idx === -1) idx = flat.indexOf(trimmed, 0);
  if (idx !== -1) return { start: idx, end: idx + trimmed.length };

  return null;
}

function findBlockAncestor(flatIndex: number): Element | null {
  if (!textMap) return null;
  const BLOCKS = new Set([
    'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'BLOCKQUOTE', 'TD', 'TH', 'DIV', 'SECTION', 'ARTICLE'
  ]);

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

function norm(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function clearHighlightInternal(): void {
  if (supportsCssHighlights()) {
    try {
      CSS.highlights.delete(CSS_HIGHLIGHT_NAME);
      CSS.highlights.delete(CSS_WORD_HIGHLIGHT_NAME);
    } catch {}
  }
  if (currentHighlightEl) {
    currentHighlightEl.classList.remove(HIGHLIGHT_CLASS, ACTIVE_CLASS);
    currentHighlightEl = null;
  }
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
    el.classList.remove(HIGHLIGHT_CLASS, ACTIVE_CLASS);
  });
  _currentRange = null;
}

/**
 * Highlight a specific word within the currently active sentence.
 */
export function highlightWord(charIndex: number, charLength = 1): void {
  if (!supportsCssHighlights()) return;
  if (!textMap) buildTextMap();

  const startOffset = currentSentenceStart + charIndex;
  const endOffset = startOffset + Math.max(1, charLength);
  const wordRange = createRangeFromOffsets(startOffset, endOffset);
  if (wordRange) {
    try {
      const wordHl = new Highlight(wordRange);
      CSS.highlights.set(CSS_WORD_HIGHLIGHT_NAME, wordHl);
    } catch {}
  }
}

function scrollIntoViewIfNeeded(el: Element): void {
  const rect = el.getBoundingClientRect();
  const margin = 80;
  const visible = rect.top >= margin && rect.bottom <= window.innerHeight - margin;
  if (!visible && rect.height > 0) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

export function clearHighlight(): void {
  clearHighlightInternal();
}

export function clearAll(): void {
  clearHighlightInternal();
  mappedBlocks = null;
  textMap = null;
  lastMatchEnd = 0;
}
