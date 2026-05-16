/**
 * Content Script — Entry Point
 * Runs on every page. Handles extraction and chunk-level sentence highlighting.
 */

import { MSG } from '../shared/constants.js';
import { extractArticle, extractSelection } from './extractor/index.js';
import { highlightSentence, clearHighlight, clearAll } from './highlighter.js';
import { log } from '../shared/logger.js';

log('content', 'log', 'Content script loaded on', location.hostname);

// ── Message handlers ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case MSG.GET_SELECTION:
      handleGetSelection(sendResponse);
      return true;

    case MSG.EXTRACT_ARTICLE:
      handleExtractArticle(sendResponse);
      return true;

    case MSG.HIGHLIGHT_CHUNK:
      handleHighlightChunk(message);
      sendResponse({ ok: true });
      return false;

    case MSG.CLEAR_HIGHLIGHTS:
      clearAll();
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
  console.log('[TTS Studio] EXTRACT_ARTICLE received, extracting...');
  const article = extractArticle();
  log('content', 'log', 'Article extracted:', article?.title, '|', article?.sentences?.length, 'sentences');
  console.log('[TTS Studio] Extracted:', article?.title, '|', article?.text?.length, 'chars');

  if (article && article.text) {
    chrome.runtime.sendMessage({
      target: 'background',
      type: MSG.ARTICLE_EXTRACTED,
      article
    }).then(() => {
      console.log('[TTS Studio] ARTICLE_EXTRACTED sent to background');
    }).catch((e) => {
      console.error('[TTS Studio] Failed to send ARTICLE_EXTRACTED:', e.message);
    });
  } else {
    console.warn('[TTS Studio] No article text extracted');
  }

  sendResponse(article);
}

function handleHighlightChunk({ chunkText }) {
  console.log('[TTS Studio] HIGHLIGHT_CHUNK received:', chunkText?.slice(0, 60));
  if (!chunkText) {
    console.warn('[TTS Studio] HIGHLIGHT_CHUNK: empty chunkText');
    return;
  }
  highlightSentence(chunkText);
}
