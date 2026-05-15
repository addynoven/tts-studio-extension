/**
 * Text sanitization for TTS input.
 * Strips unreadable tokens that humans never vocalize.
 *
 * Based on research from tts-studio, SillyTavern, and edge-tts-read-aloud.
 */

const DEFAULT_OPTIONS = {
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
 * @param {string} text - Raw input text
 * @param {object} options - Sanitization options
 * @returns {string} Cleaned text
 */
export function sanitizeForTTS(text, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let cleaned = text;

  // 1. Unicode normalization
  cleaned = cleaned.normalize('NFC');

  // 2. Strip script and style blocks FIRST (before tag stripping)
  // Otherwise <script>alert('x')</script> → alert('x') — inner text leaks through
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  cleaned = cleaned.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  cleaned = cleaned.replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ');

  // 3. HTML entity decoding (&amp; → &, &lt; → <)
  cleaned = decodeHtmlEntities(cleaned);

  // 4. Strip remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');

  // 4. Markdown formatting removal
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

  // 10. Whitespace normalization
  if (opts.normalizeWhitespace) {
    cleaned = cleaned
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  return cleaned;
}

// ── Stage helpers ──────────────────────────────────────────────────────────

function decodeHtmlEntities(text) {
  if (typeof document === 'undefined') {
    // Fallback for non-DOM contexts
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/html');
  return doc.body.textContent || text;
}

function stripMarkdown(text, readCodeBlocks) {
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

function stripCodeComments(text) {
  return text
    .replace(/\/\/.*$/gm, ' ')           // // comments
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // /* */ blocks
    .replace(/#\s+.*$/gm, ' ');           // Python/shell style comments
}

function stripEmojis(text) {
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
  },

  /** Gentle cleaning — keeps more context */
  gentle: {
    stripMarkdown: true,
    stripCodeComments: false,
    stripUrls: true,
    stripEmojis: true,
    stripFilePaths: false,
    readCodeBlocks: false
  },

  /** For developer docs — reads code comments */
  developer: {
    stripMarkdown: true,
    stripCodeComments: false,
    stripUrls: true,
    stripEmojis: true,
    stripFilePaths: false,
    readCodeBlocks: true
  }
};
