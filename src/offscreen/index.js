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
import { setPhase, setModuleStatus, setTimeline, updateTimelineItem, addTimelineItem, setQueueState, recordError, recordTiming, resetPhase } from '../shared/state-tracker.js';

// ── Message helpers ────────────────────────────────────────────────────────

function toPopup(type, extra = {}) {
  chrome.runtime.sendMessage({ target: 'popup', type, ...extra });
}

// ── Main message handler ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen') return;

  if (message.type === MSG.TTS_GENERATE) {
    setModuleStatus('offscreen', 'busy');
    handleGenerate(message).catch(e => {
      log('offscreen', 'error', 'handleGenerate failed:', e.message);
      recordError('offscreen', e.message);
      setPhase('error', { message: e.message });
      setModuleStatus('offscreen', 'error');
      toPopup(MSG.STATUS_ERROR, { error: e.message });
    }).finally(() => {
      setModuleStatus('offscreen', 'idle');
    });
  }

  if (message.type === MSG.TTS_STOP) {
    log('offscreen', 'log', 'Stop requested');
    setPhase('stopped');
    setModuleStatus('offscreen', 'idle');
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

  await resetPhase();
  setPhase('start', { model });
  setModuleStatus('offscreen', 'busy');

  resetScheduler();
  toPopup(MSG.STATUS_GENERATING);

  const onProgress = (pct) => toPopup(MSG.STATUS_PROGRESS, { percent: pct });

  try {
    setPhase('loading', { model });
    addTimelineItem({ label: `Load model: ${model}`, status: 'running' });
    const loadStart = performance.now();
    await loadModel(model, onProgress);
    recordTiming('modelLoad', performance.now() - loadStart);
    updateTimelineItem(`Load model: ${model}`, { status: 'done', durationMs: Math.round(performance.now() - loadStart) });

    await resumeAudioContext();

    // Split text into sentence chunks for natural pauses
    setPhase('generating', { model, currentChunk: 0, totalChunks: 1 });
    const sentences = splitIntoSentences(text);
    log('offscreen', 'log', 'Split into', sentences.length, 'sentences');
    sentences.forEach((s, i) => log('offscreen', 'log', `  [${i}]`, s.slice(0, 60) + (s.length > 60 ? '...' : '')));

    if (sentences.length === 0) {
      log('offscreen', 'error', 'No sentences found in text');
      recordError('offscreen', 'No text to synthesize');
      setPhase('error', { message: 'No text to synthesize' });
      toPopup(MSG.STATUS_ERROR, { error: 'No text to synthesize' });
      return;
    }

    // For short text (single sentence), just synthesize directly
    if (sentences.length === 1) {
      log('offscreen', 'log', 'Single sentence — direct synthesis');
      addTimelineItem({ label: 'Synthesize text', status: 'running' });
      const { audio, sampleRate } = await generateAudio(model, text, voice, speed);
      const buffer = createAudioBuffer(new Float32Array(audio), sampleRate);
      enqueueChunk(0, buffer);
      updateTimelineItem('Synthesize text', { status: 'done' });
      setPhase('done');
      toPopup(MSG.STATUS_DONE);
      log('offscreen', 'log', '=== GENERATE DONE (single) ===');
      return;
    }

    // Chunk sentences into groups (~300-400 chars) to balance quality vs inference count
    const chunks = chunkSentences(sentences, 350);
    const totalChunks = chunks.length;
    log('offscreen', 'log', 'Chunked into', totalChunks, 'chunks');
    chunks.forEach((c, i) => log('offscreen', 'log', `  Chunk[${i}] (${c.length} chars):`, c.slice(0, 60) + (c.length > 60 ? '...' : '')));

    // Build timeline
    const timeline = chunks.map((_, i) => ({
      label: `Synthesize chunk ${i + 1}/${totalChunks}`,
      status: 'pending'
    }));
    timeline.push({ label: 'Playback', status: 'pending' });
    await setTimeline(timeline);
    await setQueueState({ totalChunks, completedChunks: 0, scheduledIndex: 0, queueSize: 0 });

    // Synthesize chunks with limited concurrency (max 2 at a time)
    // ONNX Runtime WASM backend can get overwhelmed by too many concurrent sessions
    let completedCount = 0;
    let errorCount = 0;
    let runningCount = 0;
    let nextIndex = 0;

    function startNext() {
      while (runningCount < 2 && nextIndex < totalChunks) {
        const index = nextIndex++;
        runningCount++;
        const label = `Synthesize chunk ${index + 1}/${totalChunks}`;
        updateTimelineItem(label, { status: 'running' });
        setPhase('generating', { model, currentChunk: index, totalChunks });
        log('offscreen', 'log', `Chunk[${index}] synthesizing...`);

        synthesizeChunk(index, label).then(() => {
          runningCount--;
          completedCount++;
          setQueueState({ completedChunks: completedCount });
          log('offscreen', 'log', `Progress: ${completedCount}/${totalChunks} chunks done`);

          if (completedCount + errorCount >= totalChunks) {
            updateTimelineItem('Playback', { status: 'running' });
            setPhase('playing', { model, totalChunks });
            toPopup(MSG.STATUS_DONE);
            log('offscreen', 'log', '=== GENERATE DONE ===');
            setPhase('done');
          } else {
            startNext();
          }
        }).catch((e) => {
          runningCount--;
          errorCount++;
          log('offscreen', 'error', `Chunk[${index}] failed:`, e.message);
          recordError('offscreen', `Chunk[${index}]: ${e.message}`);
          updateTimelineItem(label, { status: 'error' });
          // Continue even if one chunk fails
          if (completedCount + errorCount >= totalChunks) {
            updateTimelineItem('Playback', { status: 'running' });
            setPhase('playing', { model, totalChunks });
            toPopup(MSG.STATUS_DONE);
            log('offscreen', 'log', '=== GENERATE DONE (with errors) ===');
            setPhase('done');
          } else {
            startNext();
          }
        });
      }
    }

    async function synthesizeChunk(index, label) {
      const startTime = performance.now();
      const { audio, sampleRate } = await generateAudio(model, chunks[index], voice, speed);
      const elapsed = Math.round(performance.now() - startTime);
      recordTiming(`chunk_${index}`, elapsed);
      log('offscreen', 'log', `Chunk[${index}] synthesized in ${elapsed}ms, ${audio.length} samples @ ${sampleRate}Hz`);
      updateTimelineItem(label, { status: 'done', durationMs: elapsed });

      const buffer = createAudioBuffer(new Float32Array(audio), sampleRate);
      enqueueChunk(index * 2, buffer);
      log('offscreen', 'log', `Chunk[${index}] enqueued at position ${index * 2}`);

      // Enqueue a pause after this chunk (except for the last one)
      if (index < totalChunks - 1) {
        const isParaBreak = isFollowedByParagraph(text, chunks[index]);
        const pauseDur = isParaBreak ? 0.7 : getPauseDuration(chunks[index], false);
        enqueuePause(index * 2 + 1, pauseDur);
        log('offscreen', 'log', `Pause[${index}] enqueued: ${(pauseDur * 1000).toFixed(0)}ms (para=${isParaBreak})`);
      }
    }

    startNext();
    // Wait for all to complete
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (completedCount + errorCount >= totalChunks) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });

  } catch (e) {
    log('offscreen', 'error', 'Top-level generate failed:', e.message);
    recordError('offscreen', e.message);
    setPhase('error', { message: e.message });
    toPopup(MSG.STATUS_ERROR, { error: e.message });
    throw e;
  }
}

log('offscreen', 'log', 'Offscreen document initialized');
