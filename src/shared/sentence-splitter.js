/**
 * Sentence splitting utilities.
 * Used by content extraction, TTS queueing, and highlighting.
 */

/**
 * Split text into sentences at natural boundaries.
 * Preserves sentence delimiters in the result.
 * @param {string} text
 * @returns {string[]}
 */
export function splitIntoSentences(text) {
  if (!text) return [];
  
  // Split at sentence endings followed by space and uppercase
  // Also split at double newlines
  return text
    .replace(/([.!?])(\s+)(?=[A-Z"'])/g, '$1\n')
    .split(/\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Get the sentence index for a given character position.
 * @param {string[]} sentences
 * @param {number} charPosition
 * @returns {number}
 */
export function getSentenceIndexAtChar(sentences, charPosition) {
  let cumulative = 0;
  for (let i = 0; i < sentences.length; i++) {
    cumulative += sentences[i].length + 1;
    if (charPosition < cumulative) return i;
  }
  return Math.max(0, sentences.length - 1);
}

/**
 * Chunk sentences into groups of roughly maxChars each.
 * Useful for TTS batching.
 * @param {string[]} sentences
 * @param {number} maxChars
 * @returns {string[]}
 */
export function chunkSentences(sentences, maxChars = 500) {
  const chunks = [];
  let current = '';
  
  for (const sentence of sentences) {
    if (current.length + sentence.length + 1 > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }
  
  if (current) chunks.push(current.trim());
  return chunks;
}
