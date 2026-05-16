/**
 * DOM-mapped text extraction.
 *
 * Walks the live DOM to build an ordered list of { element, text } blocks.
 * This preserves the mapping between extracted text and real DOM elements,
 * so highlighting can find the exact element to light up.
 *
 * Uses Readability to determine which part of the page is the article,
 * then walks the original DOM (not the clone) to find matching content.
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

/**
 * Extract article blocks mapped to real DOM elements.
 *
 * Returns:
 *  - blocks: [{ el: Element, rawText: string, ttsText: string }, ...]
 *  - title: string
 *  - fullText: string (all ttsText joined with \n)
 */
export function extractMappedArticle(sanitizerOpts = {}) {
  // Step 1: Use Readability to find article root
  const articleRoot = findArticleRoot();
  const root = articleRoot || document.body;
  const title = document.title || '';

  // Step 2: Walk real DOM, collect block-level text elements
  const blocks = [];
  walkBlocks(root, blocks);

  // Step 3: Filter out noise (too short, duplicate, nav-like)
  const filtered = blocks.filter(b => {
    const text = b.rawText.trim();
    if (text.length < 15) return false;
    // Skip elements that look like navigation/buttons
    if (text.split(/\s+/).length < 3) return false;
    return true;
  });

  // Step 4: Sanitize each block's text for TTS while keeping rawText for matching
  for (const block of filtered) {
    block.ttsText = sanitizeForTTS(block.rawText, sanitizerOpts).trim();
  }

  // Remove blocks where sanitization emptied the text
  const final = filtered.filter(b => b.ttsText.length > 5);

  const fullText = final.map(b => b.ttsText).join('\n');

  return { blocks: final, title, fullText };
}

/**
 * Find the main article container using Readability heuristics.
 * Returns the real DOM element (not a clone) that best matches.
 */
function findArticleRoot() {
  if (!isProbablyReaderable(document)) return null;

  try {
    const clone = document.cloneNode(true);
    const reader = new Readability(clone, { charThreshold: 100 });
    const article = reader.parse();
    if (!article || !article.content) return null;

    // Readability returns HTML — parse it to get the text
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = article.content;
    const articleText = tempDiv.textContent || '';

    // Find the real DOM container whose text best matches
    const candidates = document.querySelectorAll('article, main, [role="main"], .post-content, .article-body, .entry-content, #mw-content-text, .mw-parser-output');
    for (const el of candidates) {
      const elText = el.textContent || '';
      // If this element contains most of the article text, it's our root
      if (elText.length > 0 && articleText.length > 0) {
        const overlap = computeOverlap(articleText, elText);
        if (overlap > 0.6) return el;
      }
    }

    // Fallback: try common article containers
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

/**
 * Compute what fraction of textA's words appear in textB.
 */
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

/**
 * Recursively walk the DOM and collect block-level text elements.
 */
function walkBlocks(root, blocks) {
  for (const child of root.children) {
    if (SKIP_TAGS.has(child.tagName)) continue;

    // Check visibility
    const style = window.getComputedStyle(child);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    if (BLOCK_TAGS.has(child.tagName)) {
      const text = child.textContent || '';
      if (text.trim()) {
        blocks.push({ el: child, rawText: text });
      }
    } else {
      // Recurse into non-block containers (divs, sections, etc.)
      walkBlocks(child, blocks);
    }
  }
}
