/**
 * DOM-mapped text extraction.
 * Supports batch extraction for popup reading and lazy BlockIterator for streaming.
 */

import { isProbablyReaderable, Readability } from '@mozilla/readability';
import { sanitizeForTTS, type SanitizerOptions } from '../sanitizer/smart-cleaner.js';

const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'BLOCKQUOTE', 'TD', 'TH', 'FIGCAPTION', 'DT', 'DD'
]);

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS',
  'NAV', 'FOOTER', 'HEADER', 'ASIDE', 'FORM', 'INPUT', 'BUTTON',
  'SELECT', 'TEXTAREA', 'LABEL'
]);

const STOP_SECTIONS = /^(?:see also|references|external links|further reading|bibliography|citations|sources)\s*$/i;

export interface RawBlock {
  el: Element;
  rawText: string;
  html?: string;
}

export interface ExtractedBlock {
  el: Element;
  rawText: string;
  ttsText: string;
  index: number;
}

export interface MappedArticleResult {
  blocks: ExtractedBlock[];
  title: string;
  fullText: string;
}

/**
 * Lazy block iterator for streaming extraction.
 */
export class BlockIterator {
  private sanitizerOpts: SanitizerOptions;
  public cursor: number;
  private blocks: RawBlock[];
  private stopReached: boolean;
  public title: string;

  constructor(sanitizerOpts: SanitizerOptions = {}, rootElement?: Element | null) {
    this.sanitizerOpts = sanitizerOpts;
    this.cursor = 0;
    this.blocks = [];
    this.stopReached = false;

    const articleRoot = rootElement !== undefined ? rootElement : findArticleRoot();
    let root = articleRoot || document.body;
    this.title = document.title || '';

    // Step 1: Walk DOM once, collect lightweight block references
    const rawBlocks: RawBlock[] = [];
    walkBlocks(root, rawBlocks);

    // If an articleRoot was selected but produced fewer than 2 blocks, fall back to document.body
    if (rawBlocks.length < 2 && root !== document.body) {
      rawBlocks.length = 0;
      root = document.body;
      walkBlocks(root, rawBlocks);
    }

    // Step 2: Pre-filter noise without destroying quotes or valid dialogue
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

      if (text.length < 5) continue;
      this.blocks.push(b);
    }
  }

  get totalBlocks(): number {
    return this.blocks.length;
  }

  next(): ExtractedBlock | null {
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

  getBlock(index: number): ExtractedBlock | null {
    if (index < 0 || index >= this.blocks.length) return null;
    const b = this.blocks[index];
    const ttsText = this.sanitizeBlock(b);
    if (!this.shouldInclude(b, ttsText)) return null;
    return { el: b.el, rawText: b.rawText, ttsText, index };
  }

  seek(index: number): void {
    this.cursor = Math.max(0, Math.min(index, this.blocks.length));
  }

  findBlockIndexByNode(node: Node | null): number {
    if (!node) return -1;
    const targetEl = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as Element | null;
    if (!targetEl) return -1;

    // 1. Direct match or descendant match (target is within block element)
    for (let i = 0; i < this.blocks.length; i++) {
      const blockEl = this.blocks[i].el;
      if (blockEl === targetEl || blockEl.contains(targetEl)) {
        return i;
      }
    }

    // 2. Ancestor match (e.g. user selected container or outer wrapper)
    for (let i = 0; i < this.blocks.length; i++) {
      const blockEl = this.blocks[i].el;
      if (targetEl.contains(blockEl)) {
        return i;
      }
    }

    // 3. Ascend targetEl's parent chain (in case clicked element is nested in a custom wrapper)
    let curr: Element | null = targetEl.parentElement;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      for (let i = 0; i < this.blocks.length; i++) {
        const blockEl = this.blocks[i].el;
        if (blockEl === curr || blockEl.contains(curr)) {
          return i;
        }
      }
      curr = curr.parentElement;
    }

    // 4. Fallback: match by text snippet
    const text = (targetEl.textContent || '').trim();
    if (text.length >= 5) {
      const idx = this.findBlockIndexByText(text);
      if (idx !== -1) return idx;
    }

    return -1;
  }

  findBlockIndexByText(snippet: string): number {
    if (!snippet) return -1;
    const cleanSnippet = snippet.trim().toLowerCase().slice(0, 100);
    if (cleanSnippet.length < 5) return -1;

    for (let i = 0; i < this.blocks.length; i++) {
      const text = this.blocks[i].rawText.toLowerCase();
      if (text.includes(cleanSnippet) || cleanSnippet.includes(text.slice(0, 50))) {
        return i;
      }
    }
    return -1;
  }

  peek(): ExtractedBlock | null {
    const saved = this.cursor;
    const block = this.next();
    this.cursor = saved;
    return block;
  }

  private sanitizeBlock(b: RawBlock): string {
    let text = sanitizeForTTS(b.html || b.rawText, this.sanitizerOpts).trim();

    if (/^H[1-6]$/.test(b.el.tagName)) {
      if (text.length > 0 && !/[.!?]$/.test(text)) {
        text = text + '.';
      }
    }

    return text;
  }

  private shouldInclude(b: RawBlock, ttsText: string): boolean {
    const t = ttsText.trim();
    const isHeading = /^H[1-6]$/.test(b.el.tagName);

    if (isHeading && t.length > 0) return true;
    if (t.length < 5) return false;

    // Must have at least some letter or number characters
    const alphanumeric = (t.match(/[a-zA-Z0-9]/g) || []).length;
    if (alphanumeric < 3) return false;

    // Check ending punctuation (allows quotes, closing braces, brackets)
    const lastRealChar = t.replace(/\s+$/, '').slice(-1);
    if (!/[.!?:"'”’)\]]/.test(lastRealChar)) {
      // If it doesn't end in punctuation, only reject if it's very short (likely navigation noise)
      if (t.length < 30) return false;
    }

    return true;
  }
}

/**
 * Batch extraction (used by popup or legacy article reader).
 */
export function extractMappedArticle(sanitizerOpts: SanitizerOptions = {}): MappedArticleResult {
  const iter = new BlockIterator(sanitizerOpts);
  const finalBlocks: ExtractedBlock[] = [];

  let block: ExtractedBlock | null;
  while ((block = iter.next()) !== null) {
    finalBlocks.push(block);
  }

  const fullText = finalBlocks.map(b => b.ttsText).join('\n');
  return { blocks: finalBlocks, title: iter.title, fullText };
}

function findArticleRoot(): Element | null {
  if (!isProbablyReaderable(document)) return null;

  try {
    const clone = document.cloneNode(true) as Document;
    const reader = new Readability(clone, { charThreshold: 100 });
    const article = reader.parse();
    if (!article || !article.content) return null;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = article.content;
    const articleText = tempDiv.textContent || '';

    const candidates = document.querySelectorAll(
      'article, main, [role="main"], .post-content, .article-body, .entry-content, #mw-content-text, .mw-parser-output'
    );
    for (const el of Array.from(candidates)) {
      const className = typeof el.className === 'string' ? el.className.toLowerCase() : '';
      if (className.includes('emoji-keyboard') || el.getAttribute('aria-hidden') === 'true') continue;

      const elText = el.textContent || '';
      if (elText.length >= 100 && articleText.length > 0) {
        const overlap = computeOverlap(articleText, elText);
        if (overlap > 0.6) return el;
      }
    }

    const body = document.body;
    const divs = body.querySelectorAll('div');
    let bestEl: Element | null = null;
    let bestScore = 0;

    for (const div of Array.from(divs)) {
      const className = typeof div.className === 'string' ? div.className.toLowerCase() : '';
      if (className.includes('emoji-keyboard') || div.getAttribute('aria-hidden') === 'true') continue;

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

function computeOverlap(textA: string, textB: string): number {
  const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(textB.toLowerCase().split(/\s+/));
  if (wordsA.size === 0) return 0;
  let matched = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) matched++;
  }
  return matched / wordsA.size;
}

const INLINE_TAGS = new Set([
  'SPAN', 'A', 'B', 'I', 'STRONG', 'EM', 'SMALL', 'CODE', 'MARK',
  'SUB', 'SUP', 'TIME', 'ABBR', 'CITE', 'Q', 'S', 'DEL', 'INS', 'BR', 'WBR', 'IMG', 'KBD'
]);

function isLeafTextBlock(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return false;

  const className = typeof el.className === 'string' ? el.className.toLowerCase() : '';
  const role = el.getAttribute('role');

  // Explicit paragraph role or class in modern frameworks (e.g. NotebookLM "paragraph normal", Notion, Claude)
  if (role === 'paragraph' || className.includes('paragraph')) {
    return true;
  }

  // If it has children, check if all children are inline elements
  if (el.children.length > 0) {
    for (let i = 0; i < el.children.length; i++) {
      const tag = el.children[i].tagName;
      if (!INLINE_TAGS.has(tag)) {
        return false;
      }
    }
  }

  // Only consider container elements like DIV, SECTION, or custom elements (with a dash)
  if (el.tagName === 'DIV' || el.tagName === 'SECTION' || el.tagName.includes('-')) {
    const text = (el.textContent || '').trim();
    return text.length >= 15;
  }

  return false;
}

function walkBlocks(root: Element, blocks: RawBlock[]): void {
  for (const child of Array.from(root.children)) {
    if (SKIP_TAGS.has(child.tagName)) continue;
    if (child.getAttribute('aria-hidden') === 'true') continue;

    const className = typeof child.className === 'string' ? child.className.toLowerCase() : '';
    const id = (child.id || '').toLowerCase();
    if (
      className.includes('navbox') ||
      className.includes('reflist') ||
      className.includes('infobox') ||
      className.includes('toc') ||
      className.includes('metadata') ||
      className.includes('article-footer') ||
      className.includes('emoji-keyboard')
    ) continue;
    if (id === 'catlinks' || id === 'toc' || id === 'references' || id === 'feedback') continue;

    const style = window.getComputedStyle(child);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const isBlock = BLOCK_TAGS.has(child.tagName) || isLeafTextBlock(child);

    if (isBlock) {
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
