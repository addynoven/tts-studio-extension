/**
 * Sentence highlighting on the webpage.
 * Wraps sentences in spans and toggles CSS classes as audio progresses.
 */

const HIGHLIGHT_CLASS = 'tts-studio-highlight';

/**
 * Inject highlight styles into the page.
 */
export function injectStyles() {
  if (document.getElementById('tts-studio-highlight-styles')) return;

  const link = document.createElement('link');
  link.id = 'tts-studio-highlight-styles';
  link.rel = 'stylesheet';
  // In built extension, this will be served from extension assets
  // For now, inject inline as fallback
  link.href = chrome.runtime.getURL('assets/css/highlighter.css');
  document.head.appendChild(link);
}

/**
 * Highlight a specific sentence by index.
 * @param {number} index
 */
export function highlightSentence(index) {
  clearHighlights();

  const el = document.querySelector(`[data-tts-sentence="${index}"]`);
  if (!el) return;

  el.classList.add(HIGHLIGHT_CLASS);
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * Remove all highlights from the page.
 */
export function clearHighlights() {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(el => {
    el.classList.remove(HIGHLIGHT_CLASS);
  });
}

/**
 * Wrap sentences in the page with data attributes for highlighting.
 * This is a non-destructive operation that preserves the original DOM.
 *
 * NOTE: This is complex DOM surgery. For Phase 1, we use a simpler
 * approach: highlight the closest paragraph/element instead.
 * Full sentence wrapping will come in Phase 2.
 *
 * @param {Element} container
 * @param {string[]} sentences
 */
export function wrapSentences(container, sentences) {
  // TODO: Phase 2 — Implement full sentence wrapping with span injection
  // For now, we'll highlight at the paragraph level
  console.log('[TTS Studio] Sentence wrapping not yet implemented, using paragraph fallback');
}

/**
 * Highlight the paragraph containing a given character offset.
 * Simple fallback until full sentence wrapping is implemented.
 * @param {number} charOffset
 */
export function highlightAtOffset(charOffset) {
  clearHighlights();

  const paragraphs = document.querySelectorAll('p, article p, .article-body p, [class*="content"] p');
  let cumulative = 0;

  for (const p of paragraphs) {
    const text = p.textContent || '';
    cumulative += text.length;
    if (cumulative >= charOffset) {
      p.classList.add(HIGHLIGHT_CLASS);
      p.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }
}
