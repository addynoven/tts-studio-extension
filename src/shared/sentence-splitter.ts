/**
 * Sentence splitting utilities.
 * Used by content extraction, TTS queueing, and highlighting.
 */

/**
 * Split text into sentences at natural boundaries.
 * Preserves sentence delimiters in the result.
 */
export function splitIntoSentences(text: string): string[] {
  if (!text) return [];

  // Split at sentence endings followed by space and a letter (any case)
  // Also split at double newlines
  return text
    .replace(/([.!?])(\s+)(?=[A-Za-z"'])/g, '$1\n')
    .split(/\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Get the sentence index for a given character position.
 */
export function getSentenceIndexAtChar(sentences: string[], charPosition: number): number {
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
 */
export function chunkSentences(sentences: string[], maxChars = 500): string[] {
  const chunks: string[] = [];
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
