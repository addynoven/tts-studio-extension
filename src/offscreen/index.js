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
  pauseScheduler,
  resumeScheduler,
  skipToChunk,
  getNextPlayIndex,
  createAudioBuffer,
  resumeAudioContext,
  setTimingCallback
} from './audio/scheduler.js';
// ── Web Worker for ONNX inference ──────────────────────────────────────────
// Isolates heavy WASM compute from the offscreen main thread.

const WORKER_URL = chrome.runtime.getURL('tts-worker/tts-worker.js');
let worker = null;
let nextRequestId = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(WORKER_URL, { type: 'module' });
    worker.onmessage = (e) => {
      const { id, type, error, ...result } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (type === 'error') {
        p.reject(new Error(error || 'Worker error'));
      } else {
        p.resolve(result);
      }
    };
    worker.onerror = (e) => {
      log('offscreen', 'error', 'Worker error:', e.message);
    };
  }
  return worker;
}

function postToWorker(type, payload) {
  return new Promise((resolve, reject) => {
    const id = ++nextRequestId;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, type, ...payload });
  });
}

async function loadViaWorker(model, useGPU) {
  // Piper is fast enough to run on main thread; only Kitten benefits from Worker isolation
  if (model === 'piper') {
    await loadModel(model, null, useGPU);
    return;
  }
  try {
    await postToWorker('load', { model, useGPU });
  } catch (e) {
    log('offscreen', 'warn', 'Worker load failed, falling back to direct:', e.message);
    await loadModel(model, null, useGPU);
  }
}

async function inferViaWorker(model, text, voice, speed) {
  if (model === 'piper') {
    return await generateAudio(model, text, voice, speed);
  }
  try {
    return await postToWorker('infer', { model, text, voice, speed });
  } catch (e) {
    log('offscreen', 'warn', 'Worker infer failed, falling back to direct:', e.message);
    return await generateAudio(model, text, voice, speed);
  }
}
import { loadModel, generateAudio } from './tts/index.js';
import { splitIntoSentences } from '../shared/sentence-splitter.js';
import { log } from '../shared/logger.js';
import { setPhase, setModuleStatus, setTimeline, updateTimelineItem, addTimelineItem, setQueueState, recordError, recordTiming, resetPhase } from '../shared/state-tracker.js';

// ── Message helpers ────────────────────────────────────────────────────────

function toPopup(type, extra = {}) {
  chrome.runtime.sendMessage({ target: 'popup', type, ...extra });
}

function toContent(type, extra = {}) {
  chrome.runtime.sendMessage({ target: 'content', type, ...extra }).catch(() => {});
}

// ── Scheduler timing callback ──────────────────────────────────────────────
// When a chunk starts playing, tell the content script to highlight it.
// We send the chunk text so the content script can find it on the page.

let chunkTexts = []; // Array of chunk texts, indexed by scheduler chunk index
let hasAnnouncedPlaying = false;

setTimingCallback(({ index, startTime, duration }) => {
  const chunkText = chunkTexts[index];
  if (!chunkText) return;

  // Announce "playing" the first time a chunk actually starts
  if (!hasAnnouncedPlaying) {
    hasAnnouncedPlaying = true;
    toPopup(MSG.STATUS_PLAYING);
  }

  log('offscreen', 'log', `Chunk ${index} started playing, sending highlight`);
  toContent(MSG.HIGHLIGHT_CHUNK, {
    chunkIndex: index,
    chunkText,
    startTime,
    duration
  });
});

// ── Playback state for pause/resume ────────────────────────────────────────

const pb = {
  active: false,
  isPaused: false,
  sentences: [],
  paraMap: null,
  model: null,
  voice: null,
  speed: 1,
  useGPU: false,
  nextIndex: 0,
  totalChunks: 0,
  completedCount: 0,
  errorCount: 0,
  runningCount: 0,
  resolveDone: null,
};

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

  if (message.type === MSG.TTS_PAUSE) {
    log('offscreen', 'log', 'Pause requested');
    if (!pb.isPaused && pb.active) {
      pb.isPaused = true;
      pauseScheduler();
      setPhase('paused', { nextSentence: pb.nextIndex, total: pb.totalChunks });
      toPopup(MSG.STATUS_PAUSED);
    }
  }

  if (message.type === MSG.TTS_RESUME) {
    log('offscreen', 'log', 'Resume requested');
    if (pb.isPaused && pb.active) {
      pb.isPaused = false;
      resumeScheduler();
      // Restart synthesis pump if it stalled
      startSynthesisPump();
      setPhase('playing', { model: pb.model, totalChunks: pb.totalChunks });
      toPopup(MSG.STATUS_PLAYING);
    }
  }

  if (message.type === MSG.TTS_SKIP_FORWARD) {
    if (pb.active && pb.sentences.length > 0) {
      const currentSentence = Math.floor(getNextPlayIndex() / 2);
      const target = Math.min(currentSentence + 1, pb.totalChunks - 1);
      log('offscreen', 'log', `Skip forward: ${currentSentence} → ${target}`);
      skipToChunk(target * 2);
      toContent(MSG.HIGHLIGHT_CHUNK, { chunkIndex: target * 2, chunkText: pb.sentences[target] });
    }
  }

  if (message.type === MSG.TTS_SKIP_BACKWARD) {
    if (pb.active && pb.sentences.length > 0) {
      const currentSentence = Math.floor(getNextPlayIndex() / 2);
      const target = Math.max(currentSentence - 1, 0);
      log('offscreen', 'log', `Skip backward: ${currentSentence} → ${target}`);
      skipToChunk(target * 2);
      toContent(MSG.HIGHLIGHT_CHUNK, { chunkIndex: target * 2, chunkText: pb.sentences[target] });
    }
  }

  if (message.type === MSG.TTS_STOP) {
    log('offscreen', 'log', 'Stop requested');
    pb.active = false;
    pb.isPaused = false;
    setPhase('stopped');
    setModuleStatus('offscreen', 'idle');
    chunkTexts = [];
    hasAnnouncedPlaying = false;
    resetScheduler();
    toContent(MSG.CLEAR_HIGHLIGHTS);
  }
});

// ── Pause detection ────────────────────────────────────────────────────────

function getPauseDuration(chunkText, isLastChunk, speed = 1.0) {
  if (isLastChunk) return 0;

  const trimmed = chunkText.trimEnd();
  let pause = 0.3;

  if (trimmed.endsWith('\n')) pause = 0.8;
  else if (/[.!?]+$/.test(trimmed)) pause = 0.5;
  else if (/[,;:\-–—]+$/.test(trimmed)) pause = 0.25;
  else if (trimmed.endsWith('...')) pause = 0.5;

  // Scale pauses by speed so faster playback still feels natural
  return pause / speed;
}

function buildParagraphMap(originalText, chunks) {
  let offset = 0;
  const map = new Map();
  for (const chunk of chunks) {
    const idx = originalText.indexOf(chunk, offset);
    if (idx !== -1) {
      const after = originalText.slice(idx + chunk.length, idx + chunk.length + 3);
      map.set(chunk, after.includes('\n\n'));
      offset = idx + chunk.length;
    } else {
      map.set(chunk, false);
    }
  }
  return map;
}

// ── Generation handler ─────────────────────────────────────────────────────

async function handleGenerate({ text, model, voice, speed, useGPU }) {
  log('offscreen', 'log', '=== GENERATE START ===');
  log('offscreen', 'log', 'Model:', model, '| Voice:', voice, '| Speed:', speed, '| GPU:', useGPU);
  log('offscreen', 'log', 'Text length:', text.length, 'chars');

  // Reset for fresh playback
  pb.active = true;
  pb.isPaused = false;
  pb.completedCount = 0;
  pb.errorCount = 0;
  pb.runningCount = 0;
  pb.nextIndex = 0;
  hasAnnouncedPlaying = false;

  await resetPhase();
  setPhase('start', { model });
  setModuleStatus('offscreen', 'busy');

  chunkTexts = [];
  resetScheduler();
  toPopup(MSG.STATUS_GENERATING);

  const onProgress = (pct) => toPopup(MSG.STATUS_PROGRESS, { percent: pct });

  try {
    setPhase('loading', { model, useGPU });
    addTimelineItem({ label: `Load model: ${model}${useGPU ? ' (GPU)' : ''}`, status: 'running' });
    const loadStart = performance.now();
    await postToWorker('load', { model, useGPU });
    recordTiming('modelLoad', performance.now() - loadStart);
    updateTimelineItem(`Load model: ${model}${useGPU ? ' (GPU)' : ''}`, { status: 'done', durationMs: Math.round(performance.now() - loadStart) });

    await resumeAudioContext();

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

    if (sentences.length === 1) {
      log('offscreen', 'log', 'Single sentence — direct synthesis');
      addTimelineItem({ label: 'Synthesize text', status: 'running' });
      const { audio, sampleRate, playbackRate } = await inferViaWorker(model, text, voice, speed);
      const buffer = createAudioBuffer(new Float32Array(audio), sampleRate);
      chunkTexts[0] = text;
      enqueueChunk(0, buffer, playbackRate);
      updateTimelineItem('Synthesize text', { status: 'done' });
      setPhase('done');
      toPopup(MSG.STATUS_DONE);
      log('offscreen', 'log', '=== GENERATE DONE (single) ===');
      return;
    }

    // Sentence-level synthesis for natural pauses between sentences.
    const chunks = sentences;
    const totalChunks = chunks.length;
    const paraMap = buildParagraphMap(text, chunks);
    log('offscreen', 'log', 'Chunked into', totalChunks, 'sentence-level chunks');
    chunks.forEach((c, i) => log('offscreen', 'log', `  Chunk[${i}] (${c.length} chars):`, c.slice(0, 60) + (c.length > 60 ? '...' : '')));

    // Store chunk texts for highlighting
    chunks.forEach((c, i) => { chunkTexts[i * 2] = c; });

    const timeline = chunks.map((_, i) => ({
      label: `Synthesize chunk ${i + 1}/${totalChunks}`,
      status: 'pending'
    }));
    timeline.push({ label: 'Playback', status: 'pending' });
    await setTimeline(timeline);
    await setQueueState({ totalChunks, completedChunks: 0, scheduledIndex: 0, queueSize: 0 });

    // Persist playback state for pause/resume
    pb.sentences = sentences;
    pb.paraMap = paraMap;
    pb.model = model;
    pb.voice = voice;
    pb.speed = speed;
    pb.useGPU = useGPU;
    pb.totalChunks = totalChunks;
    pb.nextIndex = 0;
    pb.completedCount = 0;
    pb.errorCount = 0;
    pb.runningCount = 0;

    // Start the synthesis pump
    startSynthesisPump();

    // Wait until all chunks finish or playback is stopped
    await new Promise((resolve) => {
      pb.resolveDone = resolve;
    });

    if (pb.active) {
      updateTimelineItem('Playback', { status: 'running' });
      setPhase('done');
      toPopup(MSG.STATUS_DONE);
      log('offscreen', 'log', '=== GENERATE DONE ===');
    }

  } catch (e) {
    log('offscreen', 'error', 'Top-level generate failed:', e.message);
    recordError('offscreen', e.message);
    setPhase('error', { message: e.message });
    toPopup(MSG.STATUS_ERROR, { error: e.message });
    throw e;
  } finally {
    pb.active = false;
    pb.isPaused = false;
    if (pb.resolveDone) {
      pb.resolveDone();
      pb.resolveDone = null;
    }
  }
}

// ── Synthesis pump (can be paused/resumed) ─────────────────────────────────

function checkDone() {
  if (pb.resolveDone && pb.completedCount + pb.errorCount >= pb.totalChunks) {
    pb.resolveDone();
    pb.resolveDone = null;
  }
}

function startSynthesisPump() {
  while (pb.runningCount < 1 && pb.nextIndex < pb.totalChunks && !pb.isPaused && pb.active) {
    const index = pb.nextIndex++;
    pb.runningCount++;
    const label = `Synthesize chunk ${index + 1}/${pb.totalChunks}`;
    updateTimelineItem(label, { status: 'running' });
    setPhase('generating', { model: pb.model, currentChunk: index, totalChunks: pb.totalChunks });
    log('offscreen', 'log', `Chunk[${index}] synthesizing...`);

    synthesizeChunk(index, label).then(() => {
      pb.runningCount--;
      pb.completedCount++;
      setQueueState({ completedChunks: pb.completedCount });
      log('offscreen', 'log', `Progress: ${pb.completedCount}/${pb.totalChunks} chunks done`);
      checkDone();
      if (pb.active && !pb.isPaused) {
        startSynthesisPump();
      }
    }).catch((e) => {
      pb.runningCount--;
      pb.errorCount++;
      log('offscreen', 'error', `Chunk[${index}] failed:`, e.message);
      recordError('offscreen', `Chunk[${index}]: ${e.message}`);
      updateTimelineItem(label, { status: 'error' });
      checkDone();
      if (pb.active && !pb.isPaused) {
        startSynthesisPump();
      }
    });
  }
}

async function synthesizeChunk(index, label) {
  const chunkText = pb.sentences[index];
  const startTime = performance.now();
  const { audio, sampleRate, playbackRate } = await inferViaWorker(pb.model, chunkText, pb.voice, pb.speed);
  const elapsed = Math.round(performance.now() - startTime);
  recordTiming(`chunk_${index}`, elapsed);
  log('offscreen', 'log', `Chunk[${index}] synthesized in ${elapsed}ms, ${audio.length} samples @ ${sampleRate}Hz`);
  updateTimelineItem(label, { status: 'done', durationMs: elapsed });

  const buffer = createAudioBuffer(new Float32Array(audio), sampleRate);
  enqueueChunk(index * 2, buffer, playbackRate);
  log('offscreen', 'log', `Chunk[${index}] enqueued at position ${index * 2}`);

  if (index < pb.totalChunks - 1) {
    const isParaBreak = pb.paraMap.get(pb.sentences[index]) ?? false;
    const pauseDur = isParaBreak ? 0.8 / pb.speed : getPauseDuration(pb.sentences[index], false, pb.speed);
    enqueuePause(index * 2 + 1, pauseDur);
    log('offscreen', 'log', `Pause[${index}] enqueued: ${(pauseDur * 1000).toFixed(0)}ms (para=${isParaBreak})`);
  }
}

log('offscreen', 'log', 'Offscreen document initialized');
