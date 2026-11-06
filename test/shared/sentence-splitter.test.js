import { describe, it, expect } from 'vitest';
import {
  splitIntoSentences,
  getSentenceIndexAtChar,
  chunkSentences,
  splitTextIntoTTSChunks
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

  describe('splitTextIntoTTSChunks', () => {
    it('handles short sentences without splitting', () => {
      const text = 'Hello world. This is short.';
      const chunks = splitTextIntoTTSChunks(text, 180);
      expect(chunks).toEqual(['Hello world.', 'This is short.']);
    });

    it('splits a long sentence over maxChars into natural clauses', () => {
      const longSentence = 'The Foolish Thing to Do is the debut studio album by English electronic music duo Secret Circuit, consisting of Eddie Ruscha and Pete Swanson, which was recorded in Los Angeles between 2024 and 2025.';
      const chunks = splitTextIntoTTSChunks(longSentence, 120);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(120);
      }
    });

    it('handles empty and whitespace-only text gracefully', () => {
      expect(splitTextIntoTTSChunks('')).toEqual([]);
      expect(splitTextIntoTTSChunks('   \n\n  ')).toEqual([]);
    });

    it('preserves text content without dropping words', () => {
      const text = 'First part of the thought, followed by a second elaboration, and finally concluding with the full sentence structure.';
      const chunks = splitTextIntoTTSChunks(text, 50);
      const joined = chunks.join(' ');
      expect(joined).toContain('First part');
      expect(joined).toContain('concluding with the full sentence structure.');
    });
  });
});
