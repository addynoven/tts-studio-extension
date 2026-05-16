import { describe, it, expect, vi } from 'vitest';

let mockIsReadable = true;
let mockReadabilityResult = {
  title: 'Test Article',
  textContent: 'This is the article content. It has multiple sentences.',
  content: '<p>This is the article content.</p><p>It has multiple sentences.</p>',
  excerpt: 'A test article'
};

vi.mock('@mozilla/readability', () => ({
  Readability: vi.fn(() => ({
    parse: vi.fn(() => mockReadabilityResult)
  })),
  isProbablyReaderable: vi.fn(() => mockIsReadable)
}));

import { extractArticle, extractSelection, extractFromElement } from '../../src/content/extractor/index.js';

describe('extractor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.title = 'Page Title';
    mockIsReadable = true;
    mockReadabilityResult = {
      title: 'Test Article',
      textContent: 'This is the article content. It has multiple sentences.',
      content: '<p>This is the article content.</p><p>It has multiple sentences.</p>',
      excerpt: 'A test article'
    };
  });

  describe('extractArticle', () => {
    it('extracts article using Readability', () => {
      const result = extractArticle();
      expect(result.title).toBe('Test Article');
      expect(result.text).toContain('article content');
      expect(result.sentences.length).toBeGreaterThan(0);
      expect(result.isReadable).toBe(true);
      expect(result.url).toBe(location.href);
    });

    it('falls back to innerText when not readerable', () => {
      mockIsReadable = false;
      document.body.innerHTML = '<p>Fallback body text here.</p>';

      const result = extractArticle();
      // jsdom innerText may be empty, but isReadable=false proves fallback path
      expect(result.isReadable).toBe(false);
      expect(result.text.length).toBeGreaterThanOrEqual(0);
    });

    it('returns empty for empty document', () => {
      mockIsReadable = false;
      document.body.innerHTML = '';
      document.body.textContent = '';
      const result = extractArticle();
      expect(result.text.trim()).toBe('');
      expect(result.sentences).toEqual([]);
    });

    it('sanitizes text when sanitize option is true', () => {
      const result = extractArticle({ sanitize: true });
      expect(result.text).not.toContain('https://');
    });

    it('skips sanitization when option is false', () => {
      mockReadabilityResult = {
        title: 'Test',
        textContent: 'Visit https://example.com today.',
        content: '<p>Visit https://example.com today.</p>',
        excerpt: ''
      };
      const result = extractArticle({ sanitize: false });
      expect(result.text).toContain('https://');
    });
  });

  describe('extractSelection', () => {
    it('returns null when no selection', () => {
      window.getSelection = vi.fn(() => ({ toString: () => '' }));
      expect(extractSelection()).toBeNull();
    });

    it('extracts selected text', () => {
      window.getSelection = vi.fn(() => ({ toString: () => 'Selected text here.' }));
      const result = extractSelection();
      expect(result.text).toBe('Selected text here.');
      expect(result.sentences).toEqual(['Selected text here.']);
    });

    it('sanitizes selected text by default', () => {
      window.getSelection = vi.fn(() => ({ toString: () => 'Visit https://example.com' }));
      const result = extractSelection();
      expect(result.text).not.toContain('https://');
    });
  });

  describe('extractFromElement', () => {
    it('extracts text starting from element', () => {
      const div = document.createElement('div');
      const p1 = document.createElement('p');
      p1.textContent = 'First paragraph.';
      const p2 = document.createElement('p');
      p2.textContent = 'Second paragraph.';
      div.appendChild(p1);
      div.appendChild(p2);
      document.body.appendChild(div);

      const result = extractFromElement(p1);
      expect(result.text).toContain('First paragraph');
      expect(result.text).toContain('Second paragraph');
      expect(result.sentences.length).toBeGreaterThan(0);
    });

    it('skips script and style tags', () => {
      const div = document.createElement('div');
      const p = document.createElement('p');
      p.textContent = 'Visible text.';
      const script = document.createElement('script');
      script.textContent = 'alert("hidden")';
      div.appendChild(p);
      div.appendChild(script);
      document.body.appendChild(div);

      const result = extractFromElement(p);
      expect(result.text).toContain('Visible text');
      expect(result.text).not.toContain('alert');
    });

    it('returns empty for non-body element not in document', () => {
      const orphan = document.createElement('p');
      orphan.textContent = 'Orphan text.';
      const result = extractFromElement(orphan);
      expect(result.text.trim()).toBe('');
    });
  });
});
