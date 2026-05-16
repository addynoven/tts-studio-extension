import { describe, it, expect, beforeEach } from 'vitest';
import {
  highlightByIndex,
  highlightSentence,
  clearHighlight,
  clearAll,
  setMappedBlocks
} from '../../src/content/highlighter.js';

describe('highlighter', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    clearAll();
  });

  describe('mapped block highlighting', () => {
    it('highlights element by block index', () => {
      const p1 = document.createElement('p');
      p1.textContent = 'First paragraph text here.';
      const p2 = document.createElement('p');
      p2.textContent = 'Second paragraph with more words.';
      document.body.appendChild(p1);
      document.body.appendChild(p2);

      setMappedBlocks([
        { el: p1, rawText: p1.textContent, ttsText: p1.textContent },
        { el: p2, rawText: p2.textContent, ttsText: p2.textContent }
      ]);

      highlightByIndex(0);
      expect(p1.classList.contains('tts-studio-highlight')).toBe(true);
      expect(p2.classList.contains('tts-studio-highlight')).toBe(false);

      highlightByIndex(1);
      expect(p1.classList.contains('tts-studio-highlight')).toBe(false);
      expect(p2.classList.contains('tts-studio-highlight')).toBe(true);
    });

    it('does nothing for invalid index', () => {
      setMappedBlocks([]);
      expect(() => highlightByIndex(0)).not.toThrow();
    });

    it('does nothing when mappedBlocks is null', () => {
      expect(() => highlightByIndex(0)).not.toThrow();
    });
  });

  describe('text-search highlighting', () => {
    it('highlights paragraph containing chunk text', () => {
      const p = document.createElement('p');
      p.textContent = 'This is the target paragraph for highlighting.';
      document.body.appendChild(p);

      highlightSentence('target paragraph');
      expect(p.classList.contains('tts-studio-highlight')).toBe(true);
    });

    it('falls back to mapped blocks before text search', () => {
      const p = document.createElement('p');
      p.textContent = 'Mapped block text here.';
      document.body.appendChild(p);

      setMappedBlocks([
        { el: p, rawText: p.textContent, ttsText: p.textContent }
      ]);

      highlightSentence('Mapped block text here.');
      expect(p.classList.contains('tts-studio-highlight')).toBe(true);
    });

    it('clears previous highlight before new one', () => {
      const p1 = document.createElement('p');
      p1.textContent = 'First paragraph.';
      const p2 = document.createElement('p');
      p2.textContent = 'Second paragraph.';
      document.body.appendChild(p1);
      document.body.appendChild(p2);

      highlightSentence('First paragraph');
      expect(p1.classList.contains('tts-studio-highlight')).toBe(true);

      highlightSentence('Second paragraph');
      expect(p1.classList.contains('tts-studio-highlight')).toBe(false);
      expect(p2.classList.contains('tts-studio-highlight')).toBe(true);
    });

    it('handles empty chunk text gracefully', () => {
      expect(() => highlightSentence('')).not.toThrow();
    });

    it('handles missing text gracefully', () => {
      expect(() => highlightSentence('nonexistent text that is not on page')).not.toThrow();
    });
  });

  describe('clearHighlight / clearAll', () => {
    it('removes all highlight classes', () => {
      const p = document.createElement('p');
      p.textContent = 'Test paragraph.';
      p.classList.add('tts-studio-highlight');
      document.body.appendChild(p);

      clearHighlight();
      expect(p.classList.contains('tts-studio-highlight')).toBe(false);
    });

    it('clears mapped blocks and text map on clearAll', () => {
      const p = document.createElement('p');
      p.textContent = 'Test.';
      document.body.appendChild(p);

      setMappedBlocks([{ el: p, rawText: 'Test.', ttsText: 'Test.' }]);
      highlightByIndex(0);
      expect(p.classList.contains('tts-studio-highlight')).toBe(true);

      clearAll();
      expect(p.classList.contains('tts-studio-highlight')).toBe(false);
    });
  });

  describe('style injection', () => {
    it('injects highlight styles into document head', () => {
      const p = document.createElement('p');
      p.textContent = 'Test paragraph for style injection.';
      document.body.appendChild(p);

      highlightSentence('Test paragraph');
      const styleEl = document.getElementById('tts-studio-highlight-styles');
      expect(styleEl).not.toBeNull();
      expect(styleEl.tagName).toBe('STYLE');
    });

    it('does not duplicate style element', () => {
      const p = document.createElement('p');
      p.textContent = 'Test.';
      document.body.appendChild(p);

      highlightSentence('Test');
      highlightSentence('Test');
      const styles = document.querySelectorAll('style#tts-studio-highlight-styles');
      expect(styles.length).toBe(1);
    });
  });
});
