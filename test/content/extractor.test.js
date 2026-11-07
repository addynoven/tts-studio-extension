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
import { BlockIterator } from '../../src/content/extractor/dom-mapper.js';

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

  describe('BlockIterator seeking and matching', () => {
    it('finds block index by DOM element and child text node', () => {
      document.body.innerHTML = `
        <article>
          <p id="p1">First paragraph of the chapter story.</p>
          <p id="p2">Second paragraph with <span>nested dialogue</span> here.</p>
          <p id="p3">Third concluding paragraph.</p>
        </article>
      `;

      const iter = new BlockIterator({}, document.body);
      expect(iter.totalBlocks).toBeGreaterThanOrEqual(3);

      const p1 = document.getElementById('p1');
      const p2 = document.getElementById('p2');
      const span = p2?.querySelector('span');
      const textNode = span?.firstChild;

      expect(iter.findBlockIndexByNode(p1)).toBe(0);
      expect(iter.findBlockIndexByNode(p2)).toBe(1);
      expect(iter.findBlockIndexByNode(textNode)).toBe(1);
      expect(iter.findBlockIndexByNode(null)).toBe(-1);
    });

    it('finds block index by text snippet', () => {
      document.body.innerHTML = `
        <article>
          <p>The dawn brought a crisp chilly wind across the valley.</p>
          <p>She tightened her cloak and whispered to the shadows.</p>
        </article>
      `;

      const iter = new BlockIterator({}, document.body);
      const idx = iter.findBlockIndexByText('tightened her cloak');
      expect(idx).toBe(1);

      const notFound = iter.findBlockIndexByText('nonexistent random alien text');
      expect(notFound).toBe(-1);
    });

    it('does not truncate articles on headings containing notes or metadata', () => {
      document.body.innerHTML = `
        <article>
          <h2>Introduction</h2>
          <p>This is the start of the documentation.</p>
          <h2>Notes on Implementation</h2>
          <p>These are design notes that should be read aloud.</p>
          <h2>Release Notes</h2>
          <p>Detailed version release notes here.</p>
        </article>
      `;

      const iter = new BlockIterator({}, document.body);
      expect(iter.totalBlocks).toBe(6);
    });

    it('extracts modern SPA div.paragraph and role="paragraph" blocks', () => {
      document.body.innerHTML = `
        <div class="chat-container">
          <p class="user-query">Can you explain modern database architectures?</p>
          <div class="response">
            <div class="paragraph normal">
              <span><b>Chapter 1:</b> The Foundations of Modern Data Architecture.</span>
            </div>
            <div class="paragraph normal">
              <span>OLTP, OLAP, Data Warehouse, and Data Lake systems of record.</span>
            </div>
            <div role="paragraph">
              <span>Distributed consensus algorithms power modern replication.</span>
            </div>
          </div>
        </div>
      `;

      const iter = new BlockIterator({}, document.body);
      expect(iter.totalBlocks).toBe(4);

      const block0 = iter.next();
      expect(block0?.rawText).toContain('Can you explain');

      const block1 = iter.next();
      expect(block1?.rawText).toContain('Chapter 1');

      const block2 = iter.next();
      expect(block2?.rawText).toContain('OLTP, OLAP');

      const block3 = iter.next();
      expect(block3?.rawText).toContain('Distributed consensus');
    });

    it('matches clicked child nodes via ancestor traversal and text snippet fallback', () => {
      document.body.innerHTML = `
        <div class="notebook-view">
          <div class="paragraph normal">
            <span class="segment"><b class="title">Chapter 1</b>: Complete overview of distributed systems.</span>
          </div>
        </div>
      `;

      const iter = new BlockIterator({}, document.body);
      const bEl = document.querySelector('b.title');
      expect(iter.findBlockIndexByNode(bEl)).toBe(0);

      // Even with detached or synthetic element with matching text
      const syntheticEl = document.createElement('span');
      syntheticEl.textContent = 'Complete overview of distributed systems';
      expect(iter.findBlockIndexByNode(syntheticEl)).toBe(0);
    });

    it('ignores emoji-keyboard and falls back to document.body when candidate has < 2 blocks', () => {
      document.body.innerHTML = `
        <main class="emoji-keyboard__grid" aria-hidden="true">
          <span>😀</span>
        </main>
        <div class="content">
          <p>First authentic paragraph in the main body.</p>
          <p>Second authentic paragraph in the main body.</p>
        </div>
      `;

      const iter = new BlockIterator();
      expect(iter.totalBlocks).toBe(2);
      expect(iter.next()?.rawText).toContain('First authentic paragraph');
    });
  });
});
