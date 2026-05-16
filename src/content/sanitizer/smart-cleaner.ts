/**
 * Text sanitization for TTS input.
 * Strips unreadable tokens that humans never vocalize.
 *
 * Based on research from tts-studio, SillyTavern, and edge-tts-read-aloud.
 */

import { mathToSpeech } from './math-speech.js';

export interface SanitizerOptions {
  stripMarkdown?: boolean;
  stripCodeComments?: boolean;
  stripUrls?: boolean;
  stripEmojis?: boolean;
  stripFilePaths?: boolean;
  normalizeWhitespace?: boolean;
  readCodeBlocks?: boolean;
}

const DEFAULT_OPTIONS: Required<SanitizerOptions> = {
  stripMarkdown: true,
  stripCodeComments: true,
  stripUrls: true,
  stripEmojis: true,
  stripFilePaths: true,
  normalizeWhitespace: true,
  readCodeBlocks: false
};

/**
 * Sanitize text for TTS consumption.
 * @param text - Raw input text
 * @param options - Sanitization options
 * @returns Cleaned text
 */
export function sanitizeForTTS(text: string, options: SanitizerOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let cleaned = text;

  // 1. Unicode normalization
  cleaned = cleaned.normalize('NFC');

  // 2-4: Parse HTML and clean the DOM before extracting text
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleaned, 'text/html');

    // 1. Replace Wikipedia math elements with spoken text FIRST,
    // before stripping child images/annotations.
    doc.body.querySelectorAll('.mwe-math-element, math').forEach(el => {
      const spoken = mathToSpeech(el);
      const display = spoken ? ` ${spoken} ` : ' [formula] ';
      const textNode = doc.createTextNode(display);
      el.parentNode?.replaceChild(textNode, el);
    });

    // 2. Remove unwanted elements
    const stripSelectors = [
      'script', 'style', 'noscript', 'iframe', 'canvas', 'svg',
      // Wikipedia citations and edit links
      '.reference',
      '.mw-editsection',
      'sup.reference',
      // Navigation / boilerplate
      '.navbox',
      '.reflist',
      '.catlinks',
      '.infobox',
      '.metadata',
      '.toc',
      '#toc',
      '#catlinks',
      '#references',
      // Generic footers / edit sections
      '.page-footer',
      '.last-modified',
      '.edit-section',
      '.contributors',
      '[id*="footer"]',
      '[class*="footer"]',
      '[class*="edit" i]',
      // Code blocks (keep inline <code> text — API names read fine in TTS)
      'pre'
    ];

    stripSelectors.forEach(sel => {
      doc.body.querySelectorAll(sel).forEach(el => el.remove());
    });

    // 3. Unwrap inline code elements — keep their text, lose the formatting
    doc.body.querySelectorAll('code, kbd, samp, var').forEach(el => {
      const text = doc.createTextNode(' ' + el.textContent + ' ');
      el.parentNode?.replaceChild(text, el);
    });

    // 4. Remove visually hidden elements
    doc.body.querySelectorAll('*').forEach(el => {
      const style = el.getAttribute('style') || '';
      if (style.includes('display: none') || style.includes('display:none')) {
        el.remove();
      }
    });

    cleaned = doc.body.textContent || '';
  } else {
    // Fallback if no DOMParser (should rarely happen in extension)
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    cleaned = cleaned.replace(/<[^>]+>/g, ' ');
    cleaned = cleaned
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
  }

  // 5. Markdown formatting removal
  if (opts.stripMarkdown) {
    cleaned = stripMarkdown(cleaned, opts.readCodeBlocks);
  }

  // 5. URL replacement (must happen BEFORE code comment stripping,
  // otherwise // in https:// gets eaten by the comment regex)
  if (opts.stripUrls) {
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, ' [link] ');
    cleaned = cleaned.replace(/www\.[^\s]+/g, ' [link] ');
  }

  // 6. Code comment stripping
  if (opts.stripCodeComments) {
    cleaned = stripCodeComments(cleaned);
  }

  // 7. File path stripping
  if (opts.stripFilePaths) {
    cleaned = cleaned.replace(/(\/[^\s]+|\b[A-Za-z]:\\[^\s]+)/g, ' ');
  }

  // 8. Emoji removal
  if (opts.stripEmojis) {
    cleaned = stripEmojis(cleaned);
  }

  // 9. Number noise stripping (hex, binary)
  cleaned = cleaned.replace(/\b0x[0-9a-fA-F]+\b/g, ' ');
  cleaned = cleaned.replace(/\b0b[01]+\b/g, ' ');

  // 10. Fix punctuation spacing (leftover gaps from stripped inline math/code)
  cleaned = cleaned
    .replace(/\s+([.,;:!?\]])/g, '$1')   // "matrix ." → "matrix."
    .replace(/\[\s+/g, '[')               // "[ 1" → "[1"
    .replace(/\s+\]/g, ']')               // "1 ]" → "1]"
    .replace(/\(\s+/g, '(')               // "( x" → "(x"
    .replace(/\s+\)/g, ')')               // "x )" → "x)"
    .replace(/,\s*,+/g, ',')             // ", , ," → ","
    .replace(/\s{2,}/g, ' ');             // collapse double spaces from unwrapped code

  // 11. Whitespace normalization
  if (opts.normalizeWhitespace) {
    cleaned = cleaned
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  return cleaned;
}

// ── Stage helpers ──────────────────────────────────────────────────────────

function stripMarkdown(text: string, readCodeBlocks: boolean): string {
  let result = text;

  // Fenced code blocks
  const codeBlockRepl = readCodeBlocks ? ' [code block] ' : ' ';
  result = result.replace(/```[\s\S]*?```/g, codeBlockRepl);

  // Inline code
  const inlineCodeRepl = readCodeBlocks ? ' $1 ' : ' ';
  result = result.replace(/`([^`]+)`/g, inlineCodeRepl);

  // Bold / italic
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  result = result.replace(/\*([^*]+)\*/g, '$1');
  result = result.replace(/__([^_]+)__/g, '$1');
  result = result.replace(/_([^_]+)_/g, '$1');

  // Headers
  result = result.replace(/^#{1,6}\s+/gm, '');

  // Blockquotes
  result = result.replace(/^>\s+/gm, '');

  // Links: [text](url) → text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Images: ![alt](url) → alt
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  return result;
}

function stripCodeComments(text: string): string {
  return text
    .replace(/\/\/.*$/gm, ' ')           // // comments
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // /* */ blocks
    .replace(/#\s+.*$/gm, ' ');           // Python/shell style comments
}

function stripEmojis(text: string): string {
  // Remove emoji ranges + common symbols
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, ' ')
    .replace(/[\u{2600}-\u{26FF}]/gu, ' ')
    .replace(/[\u{2700}-\u{27BF}]/gu, ' ');
}

// ── Convenience presets ────────────────────────────────────────────────────

export const PRESETS = {
  /** Maximum cleaning — strips almost everything */
  aggressive: {
    stripMarkdown: true,
    stripCodeComments: true,
    stripUrls: true,
    stripEmojis: true,
    stripFilePaths: true,
    readCodeBlocks: false
  } satisfies SanitizerOptions,

  /** Gentle cleaning — keeps more context */
  gentle: {
    stripMarkdown: true,
    stripCodeComments: false,
    stripUrls: true,
    stripEmojis: true,
    stripFilePaths: false,
    readCodeBlocks: false
  } satisfies SanitizerOptions,

  /** For developer docs — reads code comments */
  developer: {
    stripMarkdown: true,
    stripCodeComments: false,
    stripUrls: true,
    stripEmojis: true,
    stripFilePaths: false,
    readCodeBlocks: true
  } satisfies SanitizerOptions
};
