/**
 * Offscreen Document — Entry Point
 * The engine room. Chrome MV3 service workers cannot run WASM or play audio —
 * the offscreen document gets those privileges.
 */

import { MSG } from '../shared/constants.js';
import {
  enqueueChunk,
  enqueuePause,
  resetScheduler,
  createAudioBuffer,
  resumeAudioContext
} from './audio/scheduler.js';
import { loadModel, generateAudio } from './tts/index.js';
import { splitIntoSentences, chunkSentences } from '../shared/sentence-splitter.js';
import { log } from '../shared/logger.js';

// ── Message helpers ────────────────────────────────────────────────────────

function toPopup(type, extra = {}) {
  chrome.runtime.sendMessage({ target: 'popup', type, ...extra });
}

// ── Main message handler ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen') return;

  if (message.type === MSG.TTS_GENERATE) {
    handleGenerate(message).catch(e => {
      log('offscreen', 'error', 'handleGenerate failed:', e.message);
      toPopup(MSG.STATUS_ERROR, { error: e.message });
    });
  }

  if (message.type === MSG.TTS_STOP) {
    log('offscreen', 'log', 'Stop requested');
    resetScheduler();
  }
});

// ── Pause detection ────────────────────────────────────────────────────────

/**
 * Determine how long to pause after a chunk based on its ending punctuation.
 * @param {string} chunkText
 * @param {boolean} isLastChunk
 * @returns {number} pause duration in seconds
 */
function getPauseDuration(chunkText, isLastChunk) {
  if (isLastChunk) return 0;

  const trimmed = chunkText.trimEnd();

  // Paragraph break (text had blank line after this)
  if (trimmed.endsWith('\n')) return 0.7;

  // Strong sentence endings
  if (/[.!?]+$/.test(trimmed)) return 0.4;

  // Mid-sentence pauses (rarely at chunk boundary, but possible)
  if (/[,;:\-–—]+$/.test(trimmed)) return 0.25;

  // Ellipsis
  if (trimmed.endsWith('...')) return 0.5;

  // Default gap between chunks
  return 0.3;
}

/**
 * Check if there's a paragraph break (double newline) after a sentence
 * within the original text.
 * @param {string} originalText
 * @param {string} sentence
 * @returns {boolean}
 */
function isFollowedByParagraph(originalText, sentence) {
  const idx = originalText.indexOf(sentence);
  if (idx === -1) return false;
  const after = originalText.slice(idx + sentence.length, idx + sentence.length + 3);
  return after.includes('\n\n');
}

// ── Generation handler ─────────────────────────────────────────────────────

async function handleGenerate({ text, model, voice, speed, useGPU }) {
  log('offscreen', 'log', '=== GENERATE START ===');
  log('offscreen', 'log', 'Model:', model, '| Voice:', voice, '| Speed:', speed);
  log('offscreen', 'log', 'Text length:', text.length, 'chars');

  resetScheduler();
  toPopup(MSG.STATUS_GENERATING);

  const onProgress = (pct) => toPopup(MSG.STATUS_PROGRESS, { percent: pct });

  try {
    await loadModel(model, onProgress);
    await resumeAudioContext();

    // Split text into sentence chunks for natural pauses
    const sentences = splitIntoSentences(text);
    log('offscreen', 'log', 'Split into', sentences.length, 'sentences');
    sentences.forEach((s, i) => log('offscreen', 'log', `  [${i}]`, s.slice(0, 60) + (s.length > 60 ? '...' : '')));

    if (sentences.length === 0) {
      log('offscreen', 'error', 'No sentences found in text');
      toPopup(MSG.STATUS_ERROR, { error: 'No text to synthesize' });
      return;
    }

    // For short text (single sentence), just synthesize directly
    if (sentences.length === 1) {
      log('offscreen', 'log', 'Single sentence — direct synthesis');
      const { audio, sampleRate } = await generateAudio(model, text, voice, speed);
      const buffer = createAudioBuffer(new Float32Array(audio), sampleRate);
      enqueueChunk(0, buffer);
      toPopup(MSG.STATUS_DONE);
      log('offscreen', 'log', '=== GENERATE DONE (single) ===');
      return;
    }

    // Chunk sentences into groups (~300-400 chars) to balance quality vs inference count
    const chunks = chunkSentences(sentences, 350);
    const totalChunks = chunks.length;
    log('offscreen', 'log', 'Chunked into', totalChunks, 'chunks');
    chunks.forEach((c, i) => log('offscreen', 'log', `  Chunk[${i}] (${c.length} chars):`, c.slice(0, 60) + (c.length > 60 ? '...' : '')));

    // Synthesize chunks in parallel where possible, but enqueue in order
    let completedCount = 0;

    const synthesisPromises = chunks.map(async (chunk, index) => {
      log('offscreen', 'log', `Chunk[${index}] synthesizing...`);
      try {
        const startTime = performance.now();
        const { audio, sampleRate } = await generateAudio(model, chunk, voice, speed);
        const elapsed = (performance.now() - startTime).toFixed(0);
        log('offscreen', 'log', `Chunk[${index}] synthesized in ${elapsed}ms, ${audio.length} samples @ ${sampleRate}Hz`);

        const buffer = createAudioBuffer(new Float32Array(audio), sampleRate);

        // Enqueue the audio
        enqueueChunk(index * 2, buffer);
        log('offscreen', 'log', `Chunk[${index}] enqueued at position ${index * 2}`);

        // Enqueue a pause after this chunk (except for the last one)
        if (index < totalChunks - 1) {
          const isParaBreak = isFollowedByParagraph(text, chunk);
          const pauseDur = isParaBreak ? 0.7 : getPauseDuration(chunk, false);
          enqueuePause(index * 2 + 1, pauseDur);
          log('offscreen', 'log', `Pause[${index}] enqueued: ${(pauseDur * 1000).toFixed(0)}ms (para=${isParaBreak})`);
        }

        completedCount++;
        log('offscreen', 'log', `Progress: ${completedCount}/${totalChunks} chunks done`);
        if (completedCount === totalChunks) {
          toPopup(MSG.STATUS_DONE);
          log('offscreen', 'log', '=== GENERATE DONE ===');
        }

      } catch (e) {
        log('offscreen', 'error', `Chunk[${index}] failed:`, e.message);
        // Continue with other chunks — don't let one bad chunk kill the whole article
      }
    });

    await Promise.all(synthesisPromises);

  } catch (e) {
    log('offscreen', 'error', 'Top-level generate failed:', e.message);
    toPopup(MSG.STATUS_ERROR, { error: e.message });
    throw e;
  }
}

log('offscreen', 'log', 'Offscreen document initialized');
