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

const STOP_SECTIONS = /see also|references|external links|notes|further reading|bibliography|citations|help improve|contribute|page information|metadata/i;

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

  constructor(sanitizerOpts: SanitizerOptions = {}) {
    this.sanitizerOpts = sanitizerOpts;
    this.cursor = 0;
    this.blocks = [];
    this.stopReached = false;

    const articleRoot = findArticleRoot();
    const root = articleRoot || document.body;
    this.title = document.title || '';

    // Step 1: Walk DOM once, collect lightweight block references
    const rawBlocks: RawBlock[] = [];
    walkBlocks(root, rawBlocks);

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
      const elText = el.textContent || '';
      if (elText.length > 0 && articleText.length > 0) {
        const overlap = computeOverlap(articleText, elText);
        if (overlap > 0.6) return el;
      }
    }

    const body = document.body;
    const divs = body.querySelectorAll('div');
    let bestEl: Element | null = null;
    let bestScore = 0;

    for (const div of Array.from(divs)) {
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

function walkBlocks(root: Element, blocks: RawBlock[]): void {
  for (const child of Array.from(root.children)) {
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
