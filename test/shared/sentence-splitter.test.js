import { describe, it, expect } from 'vitest';
import {
  splitIntoSentences,
  getSentenceIndexAtChar,
  chunkSentences
} from '../../src/shared/sentence-splitter.js';

describe('sentence-splitter', () => {
  describe('splitIntoSentences', () => {
    it('splits at periods', () => {
      const result = splitIntoSentences('Hello world. This is a test.');
      expect(result).toEqual(['Hello world.', 'This is a test.']);
    });

    it('splits at question and exclamation marks', () => {
      const result = splitIntoSentences('What? Really! Yes.');
      expect(result).toEqual(['What?', 'Really!', 'Yes.']);
    });

    it('splits at double newlines (paragraphs)', () => {
      const result = splitIntoSentences('First para.\n\nSecond para here.');
      expect(result).toEqual(['First para.', 'Second para here.']);
    });

    it('splits at periods followed by uppercase (abbreviations like Dr. get split too)', () => {
      // Current simple regex splits at . + space + uppercase
      // "Dr. Smith" → ["Dr.", "Smith went home."] — known limitation
      const result = splitIntoSentences('Dr. Smith went home. He was tired.');
      expect(result).toEqual(['Dr.', 'Smith went home.', 'He was tired.']);
    });

    it('handles empty string', () => {
      expect(splitIntoSentences('')).toEqual([]);
    });

    it('handles single sentence', () => {
      expect(splitIntoSentences('Just one sentence.')).toEqual(['Just one sentence.']);
    });

    it('trims whitespace', () => {
      const result = splitIntoSentences('  First.  Second.  ');
      expect(result).toEqual(['First.', 'Second.']);
    });
  });

  describe('getSentenceIndexAtChar', () => {
    it('finds correct sentence for character position', () => {
      const sentences = ['Hello.', 'World here.'];
      expect(getSentenceIndexAtChar(sentences, 0)).toBe(0);
      expect(getSentenceIndexAtChar(sentences, 5)).toBe(0);
      expect(getSentenceIndexAtChar(sentences, 7)).toBe(1);
    });

    it('returns last sentence for out-of-bounds', () => {
      const sentences = ['Short.'];
      expect(getSentenceIndexAtChar(sentences, 999)).toBe(0);
    });

    it('handles empty array', () => {
      expect(getSentenceIndexAtChar([], 0)).toBe(0);
    });
  });

  describe('chunkSentences', () => {
    it('groups sentences within maxChars', () => {
      const sentences = ['Hello.', 'World here.', 'Third sentence is longer.'];
      const chunks = chunkSentences(sentences, 50);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]).toContain('Hello.');
    });

    it('splits when exceeding maxChars', () => {
      const sentences = ['This is a long sentence.', 'Another long one here.'];
      const chunks = chunkSentences(sentences, 20);
      expect(chunks).toHaveLength(2);
    });

    it('handles single sentence', () => {
      const chunks = chunkSentences(['Only one.'], 500);
      expect(chunks).toEqual(['Only one.']);
    });

    it('handles empty array', () => {
      expect(chunkSentences([], 500)).toEqual([]);
    });

    it('never exceeds maxChars per chunk', () => {
      const sentences = Array(10).fill('Word. ');
      const chunks = chunkSentences(sentences, 30);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(30);
      }
    });
  });
});
