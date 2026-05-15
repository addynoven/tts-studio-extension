/**
 * Word Indexer — maps every visible word on the page to its DOM location.
 *
 * Walks the DOM in reading order, finds all visible text nodes,
 * splits them into words, and records each word's position.
 *
 * Used for:
 * - Word-level highlighting during TTS playback
 * - Click-to-read (find which word the user clicked)
 */

const WORD_REGEX = /[a-zA-Z0-9]+(?:[''’][a-zA-Z]+)?/g;

/**
 * Build a word map for the entire visible page.
 * @returns {{ words: string[], map: WordEntry[] }}
 */
export function buildWordMap() {
  const words = [];
  const map = [];
  let globalIndex = 0;

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        // Skip empty nodes, script/style contents, and invisible elements
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
        if (isInSkippedTag(parent)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let textNode;
  while ((textNode = walker.nextNode())) {
    const text = textNode.nodeValue;
    let match;
    WORD_REGEX.lastIndex = 0;
    while ((match = WORD_REGEX.exec(text)) !== null) {
      const word = match[0];
      words.push(word);
      map.push({
        word,
        index: globalIndex++,
        textNode,
        startOffset: match.index,
        endOffset: match.index + word.length
      });
    }
  }

  return { words, map };
}

/**
 * Find the word index at a given DOM Range or selection point.
 * @param {Range} range
 * @param {WordEntry[]} wordMap
 * @returns {number} word index, or -1 if not found
 */
export function findWordIndexAtRange(range, wordMap) {
  const node = range.startContainer;
  const offset = range.startOffset;

  for (let i = 0; i < wordMap.length; i++) {
    const entry = wordMap[i];
    if (entry.textNode === node) {
      if (offset >= entry.startOffset && offset <= entry.endOffset) {
        return i;
      }
    }
  }

  // Fallback: find closest word by comparing document position
  let closest = -1;
  let closestDist = Infinity;
  for (let i = 0; i < wordMap.length; i++) {
    const entry = wordMap[i];
    const compare = node.compareDocumentPosition(entry.textNode);
    const dist = Math.abs(offset - entry.startOffset);
    if ((compare & Node.DOCUMENT_POSITION_PRECEDING) && dist < closestDist) {
      closestDist = dist;
      closest = i;
    }
  }
  return closest;
}

/**
 * Find the word index that contains a given character position
 * in the concatenated text of all words.
 * @param {number} charPosition
 * @param {WordEntry[]} wordMap
 * @returns {number}
 */
export function findWordIndexAtChar(charPosition, wordMap) {
  let cumulative = 0;
  for (let i = 0; i < wordMap.length; i++) {
    const len = wordMap[i].word.length;
    if (charPosition < cumulative + len) return i;
    cumulative += len + 1; // +1 for space between words
  }
  return Math.max(0, wordMap.length - 1);
}

/**
 * Extract the full text from a word map, space-separated.
 * @param {WordEntry[]} wordMap
 * @returns {string}
 */
export function extractTextFromWordMap(wordMap) {
  return wordMap.map(e => e.word).join(' ');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isVisible(el) {
  const style = window.getComputedStyle(el);
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && style.opacity !== '0'
    && el.offsetParent !== null;
}

function isInSkippedTag(el) {
  const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'CODE', 'PRE'];
  let node = el;
  while (node) {
    if (skipTags.includes(node.tagName)) return true;
    node = node.parentElement;
  }
  return false;
}
