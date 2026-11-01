/**
 * Article content extraction from web pages.
 * Uses @mozilla/readability as the primary method (Firefox Reader View algorithm).
 * Falls back to innerText or selection for non-article pages.
 */

import { Readability, isProbablyReaderable } from '@mozilla/readability';
import { splitIntoSentences } from '../../shared/sentence-splitter.js';
import { sanitizeForTTS, type SanitizerOptions } from '../sanitizer/smart-cleaner.js';

export interface ExtractorOptions {
  sanitize?: boolean;
  sanitizerOpts?: SanitizerOptions;
}

export interface ExtractedArticle {
  title: string;
  text: string;
  sentences: string[];
  html: string;
  excerpt: string;
  length: number;
  url: string;
  isReadable: boolean;
}

export interface ExtractedSelection {
  text: string;
  sentences: string[];
  length: number;
}

/**
 * Extract article content from the current page.
 */
export function extractArticle(options: ExtractorOptions = {}): ExtractedArticle {
  const { sanitize = true, sanitizerOpts = {} } = options;

  const isReadable = isProbablyReaderable(document);

  let title = document.title || '';
  let text = '';
  let html = '';
  let excerpt = '';

  if (isReadable) {
    const documentClone = document.cloneNode(true) as Document;
    const reader = new Readability(documentClone);
    const article = reader.parse();

    if (article) {
      title = article.title || title;
      text = article.textContent || '';
      html = article.content || '';
      excerpt = article.excerpt || '';
    }
  }

  if (!text) {
    text = document.body.innerText || '';
  }

  if (sanitize) {
    text = sanitizeForTTS(text, sanitizerOpts);
  }

  const sentences = splitIntoSentences(text);

  return {
    title,
    text,
    sentences,
    html,
    excerpt,
    length: text.length,
    url: location.href,
    isReadable
  };
}

/**
 * Extract currently selected text.
 */
export function extractSelection(options: ExtractorOptions = {}): ExtractedSelection | null {
  const { sanitize = true, sanitizerOpts = {} } = options;

  const selection = window.getSelection()?.toString()?.trim();
  if (!selection) return null;

  let text = selection;
  if (sanitize) {
    text = sanitizeForTTS(text, sanitizerOpts);
  }

  return {
    text,
    sentences: splitIntoSentences(text),
    length: text.length
  };
}

/**
 * Extract text from a specific DOM element and its descendants.
 */
export function extractFromElement(element: Element, options: ExtractorOptions = {}): ExtractedSelection {
  const { sanitize = true, sanitizerOpts = {} } = options;

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS']);
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (parent && SKIP_TAGS.has(parent.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const texts: string[] = [];
  let found = false;
  let node: Node | null;

  while ((node = walker.nextNode())) {
    if (!found) {
      if (node.parentElement === element || element.contains(node)) {
        found = true;
      }
    }
    if (found) {
      texts.push(node.textContent || '');
    }
  }

  let text = texts.join(' ');
  if (sanitize) {
    text = sanitizeForTTS(text, sanitizerOpts);
  }

  return {
    text,
    sentences: splitIntoSentences(text),
    length: text.length
  };
}
