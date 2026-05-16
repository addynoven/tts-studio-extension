/**
 * Content Script — Entry Point
 * Runs on every page. Handles extraction and sentence highlighting.
 *
 * Two flows:
 *  1. Article flow: EXTRACT_ARTICLE → DOM-mapped extraction → ARTICLE_EXTRACTED
 *     Highlighting uses direct element references (100% accurate).
 *  2. Popup flow: User pastes text → HIGHLIGHT_CHUNK with text search.
 */

import { MSG } from '../shared/constants.js';
import { extractSelection } from './extractor/index.js';
import { extractMappedArticle } from './extractor/dom-mapper.js';
import { highlightSentence, highlightByIndex, setMappedBlocks, clearHighlight, clearAll } from './highlighter.js';
import { log } from '../shared/logger.js';
import { initMathSpeech } from './sanitizer/math-speech.js';

// Guard against double-init (manifest injection + programmatic injection)
if (!window.__ttsStudioLoaded) {
  window.__ttsStudioLoaded = true;

  log('content', 'log', 'Content script loaded on', location.hostname);

  // Initialise math verbalisation engine (SRE + LaTeX fallback).
  // Fire-and-forget: if it fails we still have the LaTeX verbalizer.
  initMathSpeech().catch(() => {});

  // ── Article block mapping ──────────────────────────────────────────────────

  let articleBlocks = null;
  let blockToChunkMap = {};

  // ── Message handlers ───────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case '__TTS_PING__':
      case '__TTS_PING':
      case '__PING__':
        sendResponse({ ok: true });
        return false;

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
        articleBlocks = null;
        blockToChunkMap = {};
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
    log('content', 'log', 'EXTRACT_ARTICLE received');

    const { blocks, title, fullText } = extractMappedArticle();
    log('content', 'log', 'Extracted:', title, '|', blocks.length, 'blocks |', fullText.length, 'chars');

    if (!blocks.length || !fullText.trim()) {
      log('content', 'warn', 'No article content found');
      sendResponse({ text: '', title, sentences: [], length: 0 });
      return;
    }

    // Store the block mapping for highlighting
    articleBlocks = blocks;
    setMappedBlocks(blocks);

    const blockTexts = blocks.map(b => b.ttsText);

    // Send to background for TTS
    chrome.runtime.sendMessage({
      target: 'background',
      type: MSG.ARTICLE_EXTRACTED,
      article: {
        title,
        text: fullText,
        blockTexts,
        length: fullText.length,
        url: location.href
      }
    }).catch((e) => {
      log('content', 'error', 'Failed to send ARTICLE_EXTRACTED:', e.message);
    });

    sendResponse({ title, text: fullText, length: fullText.length });
  }

  function handleHighlightChunk({ chunkText, chunkIndex }) {
    if (!chunkText) return;

    if (articleBlocks && articleBlocks.length > 0) {
      const blockIdx = findBlockForChunk(chunkText);
      if (blockIdx !== -1) {
        highlightByIndex(blockIdx);
        return;
      }
    }

    highlightSentence(chunkText);
  }

  function findBlockForChunk(chunkText) {
    if (!articleBlocks) return -1;
    const normChunk = chunkText.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normChunk) return -1;

    for (let i = 0; i < articleBlocks.length; i++) {
      const blockText = articleBlocks[i].ttsText.replace(/\s+/g, ' ').trim().toLowerCase();
      if (blockText.includes(normChunk)) return i;
    }

    for (let i = 0; i < articleBlocks.length; i++) {
      const rawText = articleBlocks[i].rawText.replace(/\s+/g, ' ').trim().toLowerCase();
      if (rawText.includes(normChunk)) return i;
    }

    return -1;
  }
}
