/**
 * Content Script — Entry Point
 * Runs on every page. Handles extraction, highlighting, and inline player.
 */

import { MSG } from '../shared/constants.js';
import { extractArticle, extractSelection } from './extractor/index.js';
import { highlightSentence, clearHighlights, highlightAtOffset } from './highlighter/index.js';
import { log } from '../shared/logger.js';

log('content', 'log', 'Content script loaded on', location.hostname);

// ── Message handlers ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case MSG.GET_SELECTION:
      handleGetSelection(sendResponse);
      return true; // async response

    case MSG.EXTRACT_ARTICLE:
      handleExtractArticle(sendResponse);
      return true;

    case MSG.HIGHLIGHT_SENTENCE:
      highlightSentence(message.index);
      sendResponse({ ok: true });
      return false;

    case MSG.CLEAR_HIGHLIGHT:
      clearHighlights();
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

// ── Handlers ───────────────────────────────────────────────────────────────

function handleGetSelection(sendResponse) {
  const result = extractSelection();
  log('content', 'log', 'Selection extracted:', result ? result.length + ' chars' : 'none');
  sendResponse(result || { text: '', sentences: [], length: 0 });
}

function handleExtractArticle(sendResponse) {
  const article = extractArticle();
  log('content', 'log', 'Article extracted:', article?.title, '|', article?.sentences?.length, 'sentences');

  // Send to background for TTS generation
  if (article && article.text) {
    chrome.runtime.sendMessage({
      target: 'background',
      type: MSG.ARTICLE_EXTRACTED,
      article
    });
  }

  sendResponse(article);
}
