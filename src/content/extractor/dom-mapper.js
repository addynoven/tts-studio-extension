/**
 * DOM-mapped text extraction.
 *
 * Two modes:
 *  1. BATCH: extractMappedArticle() — slurps entire page (legacy, popup use)
 *  2. STREAMING: BlockIterator — yields one block at a time (new, read-aloud use)
 *
 * Uses Readability to determine article root, then walks original DOM.
 */

import { isProbablyReaderable, Readability } from '@mozilla/readability';
import { sanitizeForTTS } from '../sanitizer/smart-cleaner.js';

const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'BLOCKQUOTE', 'TD', 'TH', 'FIGCAPTION', 'DT', 'DD'
]);

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS',
  'NAV', 'FOOTER', 'HEADER', 'ASIDE', 'FORM', 'INPUT', 'BUTTON',
  'SELECT', 'TEXTAREA', 'LABEL'
]);

const STOP_SECTIONS = /see also|references|external links|notes|further reading|bibliography|citations|help improve|contribute|page information|metadata/i;

// ── BlockIterator (Streaming) ──────────────────────────────────────────────

/**
 * Lazy block iterator for streaming extraction.
 *
 * Walks the DOM once to collect lightweight block references,
 * then sanitizes + filters on-demand as next() is called.
 * Supports seek() for skip navigation.
 */
export class BlockIterator {
  constructor(sanitizerOpts = {}) {
    this.sanitizerOpts = sanitizerOpts;
    this.cursor = 0;
    this.blocks = [];
    this.stopReached = false;

    const articleRoot = findArticleRoot();
    const root = articleRoot || document.body;
    this.title = document.title || '';

    // Step 1: Walk DOM once, collect lightweight refs (fast, low memory)
    const rawBlocks = [];
    walkBlocks(root, rawBlocks);

    // Step 2: Pre-filter noise (length, nav-like) but DON'T sanitize yet
    for (const b of rawBlocks) {
      const text = b.rawText.trim();
      const isHeading = /^H[1-6]$/.test(b.el.tagName);

      if (isHeading && STOP_SECTIONS.test(text)) {
        this.stopReached = true;
        continue;
      }
      if (this.stopReached) continue;

      if (isHeading && text.length > 0) {
        this.blocks.push(b);
        continue;
      }

      if (text.length < 15) continue;
      if (text.split(/\s+/).length < 3) continue;

      this.blocks.push(b);
    }
  }

  /**
   * Get total number of blocks (pre-filtered, not yet sanitized).
   */
  get totalBlocks() {
    return this.blocks.length;
  }

  /**
   * Yield the next sanitized block, or null if done.
   * @returns {{ el: Element, rawText: string, ttsText: string, index: number } | null}
   */
  next() {
    while (this.cursor < this.blocks.length) {
      const b = this.blocks[this.cursor++];
      const ttsText = this.sanitizeBlock(b);

      if (!this.shouldInclude(b, ttsText)) continue;

      return {
        el: b.el,
        rawText: b.rawText,
        ttsText,
        index: this.cursor - 1
      };
    }
    return null;
  }

  /**
   * Get a specific block by index (for seeking / skipping).
   * Sanitizes on-demand.
   * @param {number} index
   */
  getBlock(index) {
    if (index < 0 || index >= this.blocks.length) return null;
    const b = this.blocks[index];
    const ttsText = this.sanitizeBlock(b);
    if (!this.shouldInclude(b, ttsText)) return null;
    return { el: b.el, rawText: b.rawText, ttsText, index };
  }

  /**
   * Seek cursor to a specific block index.
   * Next next() call returns that block.
   */
  seek(index) {
    this.cursor = Math.max(0, Math.min(index, this.blocks.length));
  }

  /**
   * Peek at the current cursor position without advancing.
   */
  peek() {
    const saved = this.cursor;
    const block = this.next();
    this.cursor = saved;
    return block;
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  sanitizeBlock(b) {
    let text = sanitizeForTTS(b.html, this.sanitizerOpts).trim();

    // Add pause markers after headings
    if (/^H[1-6]$/.test(b.el.tagName)) {
      if (text.length > 0 && !/[.!?]$/.test(text)) {
        text = text + '.';
      }
    }

    return text;
  }

  shouldInclude(b, ttsText) {
    const t = ttsText.trim();
    const isHeading = /^H[1-6]$/.test(b.el.tagName);

    if (isHeading && t.length > 0) return true;

    const hasFormula = t.includes('[formula]');
    const letters = (t.match(/[a-zA-Z]/g) || []).length;
    if (hasFormula && t.length >= 30 && letters >= t.length * 0.15) return true;

    if (t.length < 25) return false;
    if (letters < t.length * 0.3) return false;

    const lastRealChar = t.replace(/\s+$/, '').slice(-1);
    if (!/[.!?]/.test(lastRealChar)) return false;

    if (/^[\(\[]/.test(t) && t.length < 60) return false;

    const firstRealChar = t.replace(/^\s+/, '')[0];
    if (firstRealChar && /[a-z]/.test(firstRealChar)) return false;

    if (/\b(Octave|Matlab|Python|implementation|code snippet)\b/i.test(t) && t.length < 90) return false;

    return true;
  }
}

// ── Batch extraction (legacy, used by popup) ───────────────────────────────

export function extractMappedArticle(sanitizerOpts = {}) {
  const iter = new BlockIterator(sanitizerOpts);
  const final = [];

  let block;
  while ((block = iter.next()) !== null) {
    final.push(block);
  }

  const fullText = final.map(b => b.ttsText).join('\n');
  return { blocks: final, title: iter.title, fullText };
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function findArticleRoot() {
  if (!isProbablyReaderable(document)) return null;

  try {
    const clone = document.cloneNode(true);
    const reader = new Readability(clone, { charThreshold: 100 });
    const article = reader.parse();
    if (!article || !article.content) return null;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = article.content;
    const articleText = tempDiv.textContent || '';

    const candidates = document.querySelectorAll('article, main, [role="main"], .post-content, .article-body, .entry-content, #mw-content-text, .mw-parser-output');
    for (const el of candidates) {
      const elText = el.textContent || '';
      if (elText.length > 0 && articleText.length > 0) {
        const overlap = computeOverlap(articleText, elText);
        if (overlap > 0.6) return el;
      }
    }

    const body = document.body;
    const divs = body.querySelectorAll('div');
    let bestEl = null;
    let bestScore = 0;

    for (const div of divs) {
      const text = div.textContent || '';
      if (text.length < articleText.length * 0.5) continue;
      if (text.length > articleText.length * 3) continue;
      const overlap = computeOverlap(articleText, text);
      if (overlap > bestScore) {
        bestScore = overlap;
        bestEl = div;
      }
    }

    return bestScore > 0.6 ? bestEl : null;
  } catch {
    return null;
  }
}

function computeOverlap(textA, textB) {
  const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(textB.toLowerCase().split(/\s+/));
  if (wordsA.size === 0) return 0;
  let matched = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) matched++;
  }
  return matched / wordsA.size;
}

function walkBlocks(root, blocks) {
  for (const child of root.children) {
    if (SKIP_TAGS.has(child.tagName)) continue;

    const className = child.className || '';
    const id = child.id || '';
    if (typeof className === 'string' && (
      className.includes('navbox') ||
      className.includes('reflist') ||
      className.includes('infobox') ||
      className.includes('toc') ||
      className.includes('metadata') ||
      className.includes('article-footer')
    )) continue;
    if (id === 'catlinks' || id === 'toc' || id === 'references' || id === 'feedback') continue;

    const style = window.getComputedStyle(child);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    if (BLOCK_TAGS.has(child.tagName)) {
      const text = child.textContent || '';
      const html = child.innerHTML || '';
      if (text.trim()) {
        blocks.push({ el: child, rawText: text, html });
      }
    } else {
      walkBlocks(child, blocks);
    }
  }
}
