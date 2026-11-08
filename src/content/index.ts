/**
 * Content Script — Entry Point
 * Runs on web pages to extract text and apply synchronized highlighting.
 */

import { MSG } from '../shared/constants.js';
import { extractSelection } from './extractor/index.js';
import { extractMappedArticle, BlockIterator, type ExtractedBlock } from './extractor/dom-mapper.js';
import { highlightSentence, highlightElement, highlightWord, clearAll, setMappedBlocks, setHighlightRoot } from './highlighter.js';
import { initInPageUI, showMiniPlayer, updateMiniPlayerState, hideMiniPlayer, showReloadToast, teardownInPageUI, setCurrentSpeed } from './in-page-ui.js';
import { getSettings, updateSettings, onSettingsChanged } from '../shared/storage.js';
import { isExtensionValid } from '../shared/messaging.js';
import { splitIntoSentences } from '../shared/sentence-splitter.js';
import { log } from '../shared/logger.js';

log('content', 'log', 'Content script loaded on', location.hostname);

declare global {
  interface Window {
    __ttsStudioListener?: (
      message: ContentMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (res?: unknown) => void
    ) => boolean | undefined;
    __ttsStudioTeardownInPageUI?: () => void;
  }
}

// Clean up any previous in-page UI from prior injections
if (typeof window.__ttsStudioTeardownInPageUI === 'function') {
  try {
    window.__ttsStudioTeardownInPageUI();
  } catch {}
}
window.__ttsStudioTeardownInPageUI = teardownInPageUI;

function safeSendBackground(type: string, payload: Record<string, unknown> = {}): void {
  if (!isExtensionValid()) {
    showReloadToast();
    teardownInPageUI();
    return;
  }
  try {
    chrome.runtime.sendMessage({ target: 'background', type, ...payload }).catch((err: Error) => {
      if (err?.message?.includes('Extension context invalidated')) {
        showReloadToast();
        teardownInPageUI();
      }
    });
  } catch (err) {
    if ((err as Error)?.message?.includes('Extension context invalidated')) {
      showReloadToast();
      teardownInPageUI();
    }
  }
}

// Initialize in-page floating quick-play button and bottom pill player
initInPageUI({
  onReadSelection: (text: string) => {
    void handleStreamStartFromSelection(text);
  },
  onTogglePlay: () => {
    if (!streamActive) {
      if (!streamIterator) {
        streamIterator = new BlockIterator();
      }
      if (streamIterator.totalBlocks > 0) {
        seekToBlock(currentBlockIndex);
        return;
      }
    }
    safeSendBackground(MSG.TTS_TOGGLE_PLAYBACK);
  },
  onStop: () => {
    safeSendBackground(MSG.TTS_STOP);
    clearAll();
  },
  onSkipForward: () => {
    if (!streamIterator) {
      streamIterator = new BlockIterator();
    }
    const nextIdx = Math.min(currentBlockIndex + 1, Math.max(0, streamIterator.totalBlocks - 1));
    log('content', 'log', 'Direct skipping forward to block:', nextIdx);
    seekToBlock(nextIdx);
  },
  onSkipBackward: () => {
    if (!streamIterator) {
      streamIterator = new BlockIterator();
    }
    const prevIdx = Math.max(0, currentBlockIndex - 1);
    log('content', 'log', 'Direct skipping backward to block:', prevIdx);
    seekToBlock(prevIdx);
  },
  onSpeedChange: (speed: number) => {
    if (!isExtensionValid()) return;
    updateSettings({ defaultSpeed: speed }).catch(() => {});
    safeSendBackground(MSG.TTS_SPEED_CHANGE, { speed });
  },
  onCopyTrackLog: () => {
    return clickTrackLogs.length > 0
      ? clickTrackLogs.join('\n\n')
      : 'No click/read trace logs recorded yet. Click on any text while reading to see tracked events.';
  }
});

// Sync initial speed from unified settings and listen for reactive updates
getSettings().then((settings) => {
  if (typeof settings.defaultSpeed === 'number') {
    setCurrentSpeed(settings.defaultSpeed);
  }
}).catch(() => {});

onSettingsChanged((newSettings) => {
  if (typeof newSettings.defaultSpeed === 'number') {
    setCurrentSpeed(newSettings.defaultSpeed);
  }
});

let streamIterator: BlockIterator | null = null;
let streamActive = false;
let currentBlockIndex = 0;
let streamEpoch = 0;

export const clickTrackLogs: string[] = [];

export function recordTrackEvent(eventType: string, details: Record<string, unknown>): void {
  const time = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  });

  const detailLines = Object.entries(details)
    .filter(([_, v]) => v !== undefined)
    .map(([k, v]) => `  • ${k}: ${typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v)}`)
    .join('\n');

  const logStr = `[${time}] ${eventType} ${details.summary || ''}\n${detailLines}`;
  clickTrackLogs.push(logStr);
  if (clickTrackLogs.length > 50) clickTrackLogs.shift();

  // Highlighted badge in DevTools Console
  console.log(
    `%c[TTS Track: ${eventType}]%c ${details.summary || ''}\n${detailLines}`,
    'background: #0284c7; color: #fff; font-weight: bold; padding: 2px 6px; border-radius: 4px;',
    'color: #38bdf8; font-weight: bold;'
  );

  log('content', 'log', `[Track: ${eventType}]`, details.summary || '', JSON.stringify(details));
}

if (typeof window !== 'undefined') {
  (window as unknown as { __ttsTrackLogs: string[] }).__ttsTrackLogs = clickTrackLogs;
  (window as unknown as { __ttsGetTrackLog: () => string }).__ttsGetTrackLog = () => clickTrackLogs.join('\n\n');
}

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
      handleExtractArticle(message, sendResponse);
      return true;

    case MSG.GET_SELECTION:
      handleGetSelection(sendResponse);
      return true;

    case MSG.STREAM_START:
      if (message.fromSelection) {
        void handleStreamStartFromSelection(message.text as string | undefined);
      } else {
        handleStreamStart(typeof message.startIndex === 'number' ? message.startIndex : 0);
      }
      sendResponse({ ok: true });
      return false;

    case MSG.TTS_SKIP_FORWARD:
      if (streamActive && streamIterator) {
        const nextIdx = Math.min(currentBlockIndex + 1, streamIterator.totalBlocks - 1);
        log('content', 'log', 'Skipping forward to block:', nextIdx);
        seekToBlock(nextIdx);
      }
      sendResponse({ ok: true });
      return false;

    case MSG.TTS_SKIP_BACKWARD:
      if (streamActive && streamIterator) {
        const prevIdx = Math.max(0, currentBlockIndex - 1);
        log('content', 'log', 'Skipping backward to block:', prevIdx);
        seekToBlock(prevIdx);
      }
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

    case MSG.HIGHLIGHT_WORD:
      if (typeof message.epoch === 'number' && message.epoch !== streamEpoch) {
        sendResponse({ ok: false });
        return false;
      }
      if (typeof message.charIndex === 'number') {
        highlightWord(message.charIndex, (message.charLength as number) || 1);
      }
      sendResponse({ ok: true });
      return false;

    case MSG.HIGHLIGHT_BLOCK:
      if (message.blockIndex !== undefined) {
        if (typeof message.epoch === 'number' && message.epoch !== streamEpoch) {
          log('content', 'warn', `Dropping HIGHLIGHT_BLOCK #${message.blockIndex} with stale epoch ${message.epoch} (current is ${streamEpoch})`);
          sendResponse({ ok: false });
          return false;
        }
        handleHighlightBlock(message.blockIndex);
      }
      sendResponse({ ok: true });
      return false;

    case MSG.STATUS_PLAYING:
      showMiniPlayer();
      updateMiniPlayerState({ isPlaying: true });
      sendResponse({ ok: true });
      return false;

    case MSG.STATUS_PAUSED:
      updateMiniPlayerState({ isPlaying: false });
      sendResponse({ ok: true });
      return false;

    case MSG.STATUS_DONE:
    case MSG.STREAM_END:
    case MSG.TTS_STOP:
      hideMiniPlayer();
      clearAll();
      streamActive = false;
      streamEpoch++;
      sendResponse({ ok: true });
      return false;

    case MSG.CLEAR_HIGHLIGHTS:
      clearAll();
      hideMiniPlayer();
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

function isPdfDocument(): boolean {
  return location.href.toLowerCase().includes('.pdf') || Boolean(document.querySelector('link[href*="pdf_embedder.css"]'));
}

function handleExtractArticle(message: ContentMessage, sendResponse: (res: unknown) => void): void {
  log('content', 'log', 'EXTRACT_ARTICLE received (batch mode), previewOnly:', Boolean(message.previewOnly));

  if (isPdfDocument()) {
    log('content', 'log', 'PDF viewer document detected; article extraction not applicable.');
    sendResponse({ text: '', title: document.title, sentences: [], length: 0 });
    return;
  }

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

  if (!message.previewOnly) {
    safeSendBackground(MSG.ARTICLE_EXTRACTED, {
      article: {
        title,
        text: fullText,
        blockTexts,
        length: fullText.length,
        url: location.href
      }
    });
  }

  sendResponse({ title, text: fullText, length: fullText.length });
}

function sliceTextFromSentenceOffset(ttsText: string, charOffset: number): string {
  if (charOffset <= 0) return ttsText;
  const sentences = splitIntoSentences(ttsText);
  if (sentences.length <= 1) return ttsText;

  let currentLen = 0;
  let targetSentenceIndex = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sLen = sentences[i].length;
    if (charOffset <= currentLen + sLen) {
      targetSentenceIndex = i;
      break;
    }
    currentLen += sLen + 1;
  }

  const sliced = sentences.slice(targetSentenceIndex).join(' ');
  return sliced.trim() || ttsText;
}

function seekToBlock(targetIndex: number, startCharOffset = 0): void {
  if (!streamIterator) return;
  streamActive = true;
  const clampedIndex = Math.max(0, Math.min(targetIndex, streamIterator.totalBlocks - 1));
  streamEpoch++;
  const thisEpoch = streamEpoch;
  currentBlockIndex = clampedIndex;
  streamIterator.seek(clampedIndex);
  safeSendBackground(MSG.STREAM_SEEK, { blockIndex: clampedIndex, epoch: thisEpoch });
  handleHighlightBlock(clampedIndex);

  const block = streamIterator.next();
  if (block) {
    let textToSend = block.ttsText;
    if (startCharOffset > 0) {
      textToSend = sliceTextFromSentenceOffset(block.ttsText, startCharOffset);
    }
    recordTrackEvent('SEEK_AND_READ', {
      summary: `Block #${block.index} starting at charOffset ${startCharOffset} (epoch ${thisEpoch})`,
      targetBlockIndex: block.index,
      startCharOffset,
      epoch: thisEpoch,
      totalParagraphChars: block.ttsText.length,
      fullParagraph: block.ttsText.slice(0, 100) + '...',
      spokenTextPreview: textToSend.slice(0, 100) + '...'
    });
    sendBlockReady({ ...block, ttsText: textToSend }, streamIterator.cursor >= streamIterator.totalBlocks);
    showMiniPlayer();
    updateMiniPlayerState({ isPlaying: true });
  }
}

function handleStreamStart(startIndex = 0): void {
  log('content', 'log', 'STREAM_START received, startIndex:', startIndex);

  if (isPdfDocument()) {
    log('content', 'log', 'PDF viewer document detected; use selection context menu to read PDF text.');
    streamActive = false;
    return;
  }

  clearAll();
  streamIterator = new BlockIterator();
  streamActive = true;
  streamEpoch++;
  const thisEpoch = streamEpoch;

  if (startIndex > 0 && startIndex < streamIterator.totalBlocks) {
    streamIterator.seek(startIndex);
  }
  currentBlockIndex = streamIterator.cursor;
  safeSendBackground(MSG.STREAM_SEEK, { blockIndex: currentBlockIndex, epoch: thisEpoch });

  log('content', 'log', 'BlockIterator initialized,', streamIterator.totalBlocks, 'raw blocks');

  const block = streamIterator.next();
  if (block) {
    handleHighlightBlock(block.index);
    sendBlockReady(block, streamIterator.cursor >= streamIterator.totalBlocks);
    showMiniPlayer();
    updateMiniPlayerState({ isPlaying: true });
  } else {
    log('content', 'warn', 'No readable blocks found on page');
    streamActive = false;
  }
}

async function handleStreamStartFromSelection(selectionText?: string): Promise<void> {
  if (!isExtensionValid()) {
    showReloadToast();
    teardownInPageUI();
    return;
  }

  const selection = window.getSelection();
  const text = selectionText || selection?.toString().trim() || '';
  const anchorNode = selection?.anchorNode;

  let iter = new BlockIterator();
  let startIndex = -1;
  let charOffset = 0;

  if (anchorNode) {
    startIndex = iter.findBlockIndexByNode(anchorNode);
  }
  if (startIndex === -1 && text) {
    startIndex = iter.findBlockIndexByText(text);
  }
  if (startIndex === -1 && anchorNode) {
    const bodyIter = new BlockIterator({}, document.body);
    const bodyIdx = bodyIter.findBlockIndexByNode(anchorNode);
    if (bodyIdx >= 0) {
      iter = bodyIter;
      startIndex = bodyIdx;
    }
  }

  if (startIndex >= 0) {
    const block = iter.getBlock(startIndex);
    if (block?.el && selection && selection.rangeCount > 0) {
      try {
        const range = selection.getRangeAt(0);
        if (block.el.contains(range.startContainer)) {
          const preRange = document.createRange();
          preRange.selectNodeContents(block.el);
          preRange.setEnd(range.startContainer, range.startOffset);
          charOffset = preRange.toString().length;
        }
      } catch {}
    }

    recordTrackEvent('SELECTION_TRIGGER', {
      summary: `Selection in Block #${startIndex} (Offset: ${charOffset})`,
      startIndex,
      charOffset,
      selectedSnippet: text.slice(0, 80)
    });

    clearAll();
    streamIterator = iter;
    streamActive = true;
    seekToBlock(startIndex, charOffset);
    return;
  }

  // Fallback to one-off TTS_GENERATE if no readable block could be matched
  if (text) {
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const rootEl = container instanceof Element ? container : container.parentElement;
      if (rootEl) setHighlightRoot(rootEl);
    }
    recordTrackEvent('SELECTION_BATCH_FALLBACK', {
      summary: `No block matched, batch fallback for "${text.slice(0, 50)}..."`,
      textLength: text.length
    });
    try {
      const settings = await getSettings();
      safeSendBackground(MSG.TTS_GENERATE, {
        text,
        model: settings.defaultModel,
        voice: settings.defaultVoice,
        speed: settings.defaultSpeed,
        useGPU: settings.executionProvider === 'webgpu'
      });
    } catch (err) {
      if ((err as Error)?.message?.includes('Extension context invalidated')) {
        showReloadToast();
        teardownInPageUI();
      }
    }
  }
}

function handleRequestBlock(message: ContentMessage, sendResponse: (res: unknown) => void): void {
  if (typeof message.epoch === 'number' && message.epoch !== streamEpoch) {
    log('content', 'warn', `Dropping stale REQUEST_BLOCK epoch ${message.epoch}, current is ${streamEpoch}`);
    sendResponse({ ok: false, error: 'Stale epoch' });
    return;
  }
  const index = message.blockIndex ?? -1;
  log('content', 'log', `REQUEST_BLOCK: ${index} (epoch: ${message.epoch})`);

  if (!streamIterator || !streamActive) {
    log('content', 'warn', 'REQUEST_BLOCK but no active stream');
    sendResponse({ ok: false, error: 'No active stream' });
    return;
  }

  if (index >= 0 && index !== streamIterator.cursor) {
    streamIterator.seek(index);
  }

  const block = streamIterator.next();
  const isLast = !block || streamIterator.cursor >= streamIterator.totalBlocks;

  if (block) {
    sendBlockReady(block, isLast);
    sendResponse({ ok: true, index: block.index, isLast });
  } else {
    streamActive = false;
    safeSendBackground(MSG.STREAM_END);
    sendResponse({ ok: true, index: -1, isLast: true });
  }
}

function sendBlockReady(block: ExtractedBlock, isLast: boolean): void {
  safeSendBackground(MSG.BLOCK_READY, {
    block: {
      index: block.index,
      text: block.ttsText,
      isLastBlock: isLast,
      epoch: streamEpoch
    }
  });
}

function handleHighlightBlock(blockIndex: number): void {
  if (!streamIterator || blockIndex < 0) return;
  currentBlockIndex = blockIndex;
  const block = streamIterator.getBlock(blockIndex);
  if (block?.el) {
    recordTrackEvent('HIGHLIGHT_UPDATE', {
      summary: `Block #${blockIndex} highlighted in view`,
      blockIndex,
      blockTextSnippet: block.ttsText.slice(0, 80)
    });
    highlightElement(block.el);
  }
}

// Click-to-seek listener (Edge Read Aloud style)
document.addEventListener('click', (e: MouseEvent) => {
  const target = e.target as HTMLElement | null;
  if (!target) return;

  // Skip our own UI (floating button, mini player, toast, etc.)
  if (target.closest('.tts-studio-float-btn, .tts-mini-player, #tts-studio-root, .tts-toast')) {
    return;
  }

  // Skip interactive form elements
  if (target.closest('input, textarea, select, option, [contenteditable="true"]')) {
    return;
  }

  // Skip if user was dragging or selecting text
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && (sel.toString() || '').trim().length > 0) {
    return;
  }

  // If stream is not currently active, don't hijack links or navigation menus
  if (!streamActive) {
    if (target.closest('a, nav, footer, header, aside, .nav, .menu, .sidebar, #mw-navigation, #vector-toc')) {
      return;
    }
  }

  if (!streamIterator) {
    streamIterator = new BlockIterator();
  }

  let clickedIndex = streamIterator.findBlockIndexByNode(target);

  // If not found in current streamIterator, try a fresh fallback using document.body
  if (clickedIndex < 0) {
    const bodyIter = new BlockIterator({}, document.body);
    const bodyIdx = bodyIter.findBlockIndexByNode(target);
    if (bodyIdx >= 0) {
      streamIterator = bodyIter;
      clickedIndex = bodyIdx;
    }
  }

  recordTrackEvent('MOUSE_CLICK', {
    summary: `<${target.tagName.toLowerCase()}> at (${e.clientX}, ${e.clientY})`,
    tag: target.tagName,
    id: target.id || undefined,
    className: target.className || undefined,
    clickedSnippet: (target.textContent || '').trim().slice(0, 80),
    isInsideLink: Boolean(target.closest('a')),
    matchedBlockIndex: clickedIndex,
    streamActive
  });

  if (clickedIndex >= 0) {
    streamActive = true;
    // If clicking a link within the readable block while TTS is active, prevent navigation
    if (target.closest('a')) {
      e.preventDefault();
      e.stopPropagation();
    }

    const block = streamIterator.getBlock(clickedIndex);
    let charOffset = 0;

    if (block?.el) {
      try {
        let range: Range | null = null;
        if (typeof document.caretRangeFromPoint === 'function') {
          range = document.caretRangeFromPoint(e.clientX, e.clientY);
        } else if ((document as unknown as { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } }).caretPositionFromPoint) {
          const pos = (document as unknown as { caretPositionFromPoint: (x: number, y: number) => { offsetNode: Node; offset: number } }).caretPositionFromPoint(e.clientX, e.clientY);
          if (pos) {
            range = document.createRange();
            range.setStart(pos.offsetNode, pos.offset);
          }
        }
        if (range && block.el.contains(range.startContainer)) {
          const preRange = document.createRange();
          preRange.selectNodeContents(block.el);
          preRange.setEnd(range.startContainer, range.startOffset);
          charOffset = preRange.toString().length;
        }
      } catch {}
    }

    recordTrackEvent('CLICK_SEEK_DISPATCH', {
      summary: `Seeking to Block #${clickedIndex} at charOffset ${charOffset}`,
      blockIndex: clickedIndex,
      charOffset,
      blockTagName: block?.el?.tagName,
      paragraphPreview: block?.ttsText?.slice(0, 80)
    });

    seekToBlock(clickedIndex, charOffset);
  }
}, true);
