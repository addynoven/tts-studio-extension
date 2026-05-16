/**
 * Content Script — Entry Point
 * Runs on every page.
 *
 * Two modes:
 *  1. BATCH (legacy): EXTRACT_ARTICLE → extractMappedArticle → ARTICLE_EXTRACTED
 *  2. STREAMING (new): STREAM_START → BlockIterator → BLOCK_READY per block
 */

import { MSG } from '../shared/constants.js';
import { extractSelection } from './extractor/index.js';
import { extractMappedArticle, BlockIterator } from './extractor/dom-mapper.js';
import { highlightSentence, highlightElement, clearHighlight, clearAll } from './highlighter.js';
import { log } from '../shared/logger.js';

// Guard against double-init
if (!window.__ttsStudioLoaded) {
  window.__ttsStudioLoaded = true;
  log('content', 'log', 'Content script loaded on', location.hostname);

  // ── Streaming state ────────────────────────────────────────────────────────

  let streamIterator = null;
  let streamActive = false;

  // ── Message handlers ───────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      // ── Ping ──
      case '__TTS_PING__':
      case '__TTS_PING':
      case '__PING__':
        sendResponse({ ok: true });
        return false;

      // ── Legacy batch extraction ──
      case MSG.EXTRACT_ARTICLE:
        handleExtractArticle(sendResponse);
        return true;

      case MSG.GET_SELECTION:
        handleGetSelection(sendResponse);
        return true;

      // ── Streaming protocol ──
      case MSG.STREAM_START:
        handleStreamStart(message);
        sendResponse({ ok: true });
        return false;

      case MSG.REQUEST_BLOCK:
        handleRequestBlock(message, sendResponse);
        return true;

      // ── Highlighting ──
      case MSG.HIGHLIGHT_CHUNK:
        handleHighlightChunk(message);
        sendResponse({ ok: true });
        return false;

      case MSG.HIGHLIGHT_BLOCK:
        handleHighlightBlock(message);
        sendResponse({ ok: true });
        return false;

      case MSG.CLEAR_HIGHLIGHTS:
        clearAll();
        streamIterator = null;
        streamActive = false;
        sendResponse({ ok: true });
        return false;

      default:
        return false;
    }
  });

  // ── Legacy handlers ────────────────────────────────────────────────────────

  function handleGetSelection(sendResponse) {
    const result = extractSelection();
    log('content', 'log', 'Selection extracted:', result ? result.length + ' chars' : 'none');
    sendResponse(result || { text: '', sentences: [], length: 0 });
  }

  function handleExtractArticle(sendResponse) {
    log('content', 'log', 'EXTRACT_ARTICLE received (batch mode)');

    const { blocks, title, fullText } = extractMappedArticle();
    log('content', 'log', 'Extracted:', title, '|', blocks.length, 'blocks |', fullText.length, 'chars');

    if (!blocks.length || !fullText.trim()) {
      log('content', 'warn', 'No article content found');
      sendResponse({ text: '', title, sentences: [], length: 0 });
      return;
    }

    const blockTexts = blocks.map(b => b.ttsText);

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

  // ── Streaming handlers ─────────────────────────────────────────────────────

  function handleStreamStart(message) {
    log('content', 'log', 'STREAM_START received');

    clearAll();
    streamIterator = new BlockIterator();
    streamActive = true;

    log('content', 'log', 'BlockIterator initialized,', streamIterator.totalBlocks, 'raw blocks');

    // Immediately send block 0 to start playback quickly
    const block = streamIterator.next();
    if (block) {
      sendBlockReady(block, false);
    } else {
      log('content', 'warn', 'No readable blocks found on page');
      streamActive = false;
    }
  }

  function handleRequestBlock(message, sendResponse) {
    const index = message.blockIndex ?? -1;
    log('content', 'log', 'REQUEST_BLOCK:', index);

    if (!streamIterator || !streamActive) {
      log('content', 'warn', 'REQUEST_BLOCK but no active stream');
      sendResponse({ ok: false, error: 'No active stream' });
      return;
    }

    // If index is specified and different from cursor, seek
    if (index >= 0 && index !== streamIterator.cursor) {
      streamIterator.seek(index);
    }

    const block = streamIterator.next();
    const isLast = streamIterator.cursor >= streamIterator.totalBlocks;

    if (block) {
      sendBlockReady(block, isLast);
      sendResponse({ ok: true, index: block.index, isLast });
    } else {
      // No more blocks
      streamActive = false;
      sendResponse({ ok: true, index: -1, isLast: true });
    }
  }

  function sendBlockReady(block, isLast) {
    chrome.runtime.sendMessage({
      target: 'background',
      type: MSG.BLOCK_READY,
      block: {
        index: block.index,
        text: block.ttsText,
        isLastBlock: isLast
      }
    }).catch((e) => {
      log('content', 'error', 'Failed to send BLOCK_READY:', e.message);
    });
  }

  // ── Highlight handlers ─────────────────────────────────────────────────────

  function handleHighlightChunk({ chunkText }) {
    if (!chunkText) return;
    highlightSentence(chunkText);
  }

  function handleHighlightBlock({ blockIndex }) {
    if (!streamIterator || blockIndex < 0) return;
    const block = streamIterator.getBlock(blockIndex);
    if (block?.el) {
      highlightElement(block.el);
    }
  }
}
