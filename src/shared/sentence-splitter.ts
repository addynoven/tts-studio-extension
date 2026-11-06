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

/**
 * Sub-chunk a single long sentence into clause-level fragments under maxLen.
 * Splits on punctuation: semicolons, colons, dashes, commas, or spaces.
 */
function splitLongSentence(sentence: string, maxLen: number): string[] {
  if (sentence.length <= maxLen) return [sentence];
  const parts: string[] = [];
  let remaining = sentence;

  while (remaining.length > maxLen) {
    const window = remaining.slice(0, maxLen);
    let cutIdx = -1;

    // 1. Try semicolon, colon, em-dash, en-dash, or ellipsis
    const majorPunc = window.match(/.*([;:\u2014\u2013]|\s-\s|\.\.\.)/);
    if (majorPunc && majorPunc[0].length >= 35) {
      cutIdx = majorPunc[0].length;
    } else {
      // 2. Try comma followed by whitespace
      const commaMatch = window.match(/.*,\s+/);
      if (commaMatch && commaMatch[0].length >= 35) {
        cutIdx = commaMatch[0].length;
      } else {
        // 3. Fall back to last whitespace before maxLen
        const spaceIdx = window.lastIndexOf(' ');
        cutIdx = spaceIdx > 25 ? spaceIdx + 1 : maxLen;
      }
    }

    const chunk = remaining.slice(0, cutIdx).trim();
    if (chunk) parts.push(chunk);
    remaining = remaining.slice(cutIdx).trim();
  }

  if (remaining) parts.push(remaining);
  return parts;
}

/**
 * Split text into individual sentences and natural clause chunks under maxChars (default 180).
 * Prevents dynamic shape VRAM exhaustion on WebGPU vocoders and provides smooth highlighting.
 */
export function splitTextIntoTTSChunks(text: string, maxChars = 180): string[] {
  if (!text) return [];
  const sentences = splitIntoSentences(text);
  const chunks: string[] = [];

  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      chunks.push(sentence);
    } else {
      chunks.push(...splitLongSentence(sentence, maxChars));
    }
  }

  return chunks;
}

