/**
 * Content Script — Entry Point
 * Runs on web pages to extract text and apply synchronized highlighting.
 */

import { MSG } from '../shared/constants.js';
import { extractSelection } from './extractor/index.js';
import { extractMappedArticle, BlockIterator, type ExtractedBlock } from './extractor/dom-mapper.js';
import { highlightSentence, highlightElement, clearAll, setMappedBlocks } from './highlighter.js';
import { log } from '../shared/logger.js';

log('content', 'log', 'Content script loaded on', location.hostname);

let streamIterator: BlockIterator | null = null;
let streamActive = false;

interface ContentMessage {
  type: string;
  blockIndex?: number;
  chunkText?: string;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __ttsStudioListener?: (
      message: ContentMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (res?: unknown) => void
    ) => boolean | undefined;
  }
}

function ttsMessageHandler(
  message: ContentMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (res?: unknown) => void
): boolean | undefined {
  switch (message.type) {
    case '__TTS_PING__':
    case '__TTS_PING':
    case '__PING__':
      sendResponse({ ok: true });
      return false;

    case MSG.EXTRACT_ARTICLE:
      handleExtractArticle(sendResponse);
      return true;

    case MSG.GET_SELECTION:
      handleGetSelection(sendResponse);
      return true;

    case MSG.STREAM_START:
      handleStreamStart();
      sendResponse({ ok: true });
      return false;

    case MSG.REQUEST_BLOCK:
      handleRequestBlock(message, sendResponse);
      return true;

    case MSG.HIGHLIGHT_CHUNK:
      if (message.chunkText) {
        highlightSentence(message.chunkText);
      }
      sendResponse({ ok: true });
      return false;

    case MSG.HIGHLIGHT_BLOCK:
      if (message.blockIndex !== undefined) {
        handleHighlightBlock(message.blockIndex);
      }
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
}

if (window.__ttsStudioListener) {
  try {
    chrome.runtime.onMessage.removeListener(window.__ttsStudioListener);
  } catch {}
}
window.__ttsStudioListener = ttsMessageHandler;
chrome.runtime.onMessage.addListener(ttsMessageHandler);

function handleGetSelection(sendResponse: (res: unknown) => void): void {
  const result = extractSelection();
  log('content', 'log', 'Selection extracted:', result ? result.length + ' chars' : 'none');
  sendResponse(result || { text: '', sentences: [], length: 0 });
}

function handleExtractArticle(sendResponse: (res: unknown) => void): void {
  log('content', 'log', 'EXTRACT_ARTICLE received (batch mode)');

  const { blocks, title, fullText } = extractMappedArticle();
  log('content', 'log', 'Extracted:', title, '|', blocks.length, 'blocks |', fullText.length, 'chars');

  // Store mapped blocks for highlighting synchronization
  setMappedBlocks(blocks);

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
  }).catch((e: Error) => {
    log('content', 'error', 'Failed to send ARTICLE_EXTRACTED:', e.message);
  });

  sendResponse({ title, text: fullText, length: fullText.length });
}

function handleStreamStart(): void {
  log('content', 'log', 'STREAM_START received');

  clearAll();
  streamIterator = new BlockIterator();
  streamActive = true;

  log('content', 'log', 'BlockIterator initialized,', streamIterator.totalBlocks, 'raw blocks');

  const block = streamIterator.next();
  if (block) {
    sendBlockReady(block, false);
  } else {
    log('content', 'warn', 'No readable blocks found on page');
    streamActive = false;
  }
}

function handleRequestBlock(message: ContentMessage, sendResponse: (res: unknown) => void): void {
  const index = message.blockIndex ?? -1;
  log('content', 'log', 'REQUEST_BLOCK:', index);

  if (!streamIterator || !streamActive) {
    log('content', 'warn', 'REQUEST_BLOCK but no active stream');
    sendResponse({ ok: false, error: 'No active stream' });
    return;
  }

  if (index >= 0 && index !== streamIterator.cursor) {
    streamIterator.seek(index);
  }

  const block = streamIterator.next();
  const isLast = streamIterator.cursor >= streamIterator.totalBlocks;

  if (block) {
    sendBlockReady(block, isLast);
    sendResponse({ ok: true, index: block.index, isLast });
  } else {
    streamActive = false;
    sendResponse({ ok: true, index: -1, isLast: true });
  }
}

function sendBlockReady(block: ExtractedBlock, isLast: boolean): void {
  chrome.runtime.sendMessage({
    target: 'background',
    type: MSG.BLOCK_READY,
    block: {
      index: block.index,
      text: block.ttsText,
      isLastBlock: isLast
    }
  }).catch((e: Error) => {
    log('content', 'error', 'Failed to send BLOCK_READY:', e.message);
  });
}

function handleHighlightBlock(blockIndex: number): void {
  if (!streamIterator || blockIndex < 0) return;
  const block = streamIterator.getBlock(blockIndex);
  if (block?.el) {
    highlightElement(block.el);
  }
}
