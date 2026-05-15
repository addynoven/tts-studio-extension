import { describe, it, expect } from 'vitest';
import { sanitizeForTTS, PRESETS } from '../../src/content/sanitizer/smart-cleaner.js';

describe('smart-cleaner', () => {
  it('strips HTML tags', () => {
    const result = sanitizeForTTS('<p>Hello <b>world</b></p>');
    expect(result).toContain('Hello');
    expect(result).toContain('world');
    expect(result).not.toContain('<p>');
    expect(result).not.toContain('<b>');
  });

  it('strips script blocks entirely', () => {
    const result = sanitizeForTTS('Before<script>alert("x")</script>After');
    expect(result).toContain('Before');
    expect(result).toContain('After');
    expect(result).not.toContain('alert');
  });

  it('strips style blocks entirely', () => {
    const result = sanitizeForTTS('Hello<style>.red{color:red}</style>World');
    expect(result).toContain('Hello');
    expect(result).toContain('World');
    expect(result).not.toContain('.red');
  });

  it('decodes HTML entities', () => {
    const result = sanitizeForTTS('Hello &amp; goodbye &lt;3');
    expect(result).toContain('Hello & goodbye');
    expect(result).toContain('<3');
  });

  it('strips markdown bold/italic', () => {
    const result = sanitizeForTTS('**bold** and *italic* and __also__ _this_');
    expect(result).toContain('bold');
    expect(result).toContain('italic');
    expect(result).not.toContain('**');
    expect(result).not.toContain('*');
  });

  it('strips markdown headers', () => {
    const result = sanitizeForTTS('# Heading 1\n## Heading 2');
    expect(result).toContain('Heading 1');
    expect(result).toContain('Heading 2');
    expect(result).not.toContain('#');
  });

  it('replaces URLs with [link]', () => {
    const result = sanitizeForTTS('Visit https://example.com today');
    expect(result).toContain('[link]');
    expect(result).not.toContain('https://');
  });

  it('strips emojis', () => {
    const result = sanitizeForTTS('Hello 😀 world 🎉');
    expect(result).toContain('Hello');
    expect(result).toContain('world');
    expect(result).not.toContain('😀');
    expect(result).not.toContain('🎉');
  });

  it('strips code comments', () => {
    const result = sanitizeForTTS('code // this is a comment\nmore code');
    expect(result).toContain('code');
    expect(result).toContain('more code');
    expect(result).not.toContain('//');
  });

  it('strips block comments', () => {
    const result = sanitizeForTTS('before /* comment */ after');
    expect(result).toContain('before');
    expect(result).toContain('after');
    expect(result).not.toContain('/*');
  });

  it('strips file paths', () => {
    const result = sanitizeForTTS('Check /usr/bin/file or C:\\Windows\\file.txt');
    expect(result).not.toContain('/usr/bin');
    expect(result).not.toContain('C:\\Windows');
  });

  it('preserves readable text content', () => {
    const input = 'The quick brown fox jumps over the lazy dog.';
    const result = sanitizeForTTS(input);
    expect(result).toContain('The quick brown fox jumps over the lazy dog');
  });

  it('handles empty string', () => {
    expect(sanitizeForTTS('')).toBe('');
  });

  it('preserves code blocks with developer preset', () => {
    const result = sanitizeForTTS('```code```', PRESETS.developer);
    expect(result).toContain('code block');
  });

  it('strips code blocks with aggressive preset', () => {
    const result = sanitizeForTTS('```code```', PRESETS.aggressive);
    expect(result).not.toContain('code');
  });

  it('keeps markdown links text only', () => {
    const result = sanitizeForTTS('[click here](https://example.com)');
    expect(result).toContain('click here');
    expect(result).not.toContain('https://');
    expect(result).not.toContain('[');
  });
});
