/**
 * Article content extraction from web pages.
 * Uses @mozilla/readability as the primary method (Firefox Reader View algorithm).
 * Falls back to innerText or selection for non-article pages.
 */

import { Readability, isProbablyReaderable } from '@mozilla/readability';
import { splitIntoSentences } from '../../shared/sentence-splitter.js';
import { sanitizeForTTS } from '../sanitizer/smart-cleaner.js';

/**
 * Extract article content from the current page.
 * @param {object} options - { sanitize: true, sanitizerOpts: {} }
 * @returns {object|null} { title, text, sentences[], html, excerpt, length, url }
 */
export function extractArticle(options = {}) {
  const { sanitize = true, sanitizerOpts = {} } = options;

  // Check if page looks like an article
  const isReadable = isProbablyReaderable(document);

  let title = document.title || '';
  let text = '';
  let html = '';
  let excerpt = '';

  if (isReadable) {
    // Use Mozilla Readability (same as Firefox Reader View)
    const documentClone = document.cloneNode(true);
    const reader = new Readability(documentClone);
    const article = reader.parse();

    if (article) {
      title = article.title || title;
      text = article.textContent || '';
      html = article.content || '';
      excerpt = article.excerpt || '';
    }
  }

  // Fallback: if Readability fails or page isn't an article
  if (!text) {
    text = document.body.innerText || '';
  }

  // Sanitize before splitting
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
 * @param {object} options - { sanitize: true, sanitizerOpts: {} }
 * @returns {object|null} { text, sentences[], length }
 */
export function extractSelection(options = {}) {
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
 * Useful for "Read from here" feature.
 * @param {Element} element
 * @param {object} options
 * @returns {object}
 */
export function extractFromElement(element, options = {}) {
  const { sanitize = true, sanitizerOpts = {} } = options;

  // Skip text inside script/style/noscript/iframe elements
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
    },
    false
  );

  const texts = [];
  let found = false;
  let node;

  while (node = walker.nextNode()) {
    if (!found) {
      if (node.parentElement === element || element.contains(node)) {
        found = true;
      }
    }
    if (found) {
      texts.push(node.textContent);
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
