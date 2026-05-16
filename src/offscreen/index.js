/**
 * Offscreen Document — Entry Point
 * The engine room. Chrome MV3 service workers cannot run WASM or play audio —
 * the offscreen document gets those privileges.
 *
 * Two modes:
 *  1. MANUAL (legacy): TTS_GENERATE with full text — one-shot playback
 *  2. STREAMING (new): TTS_BUFFER blocks continuously — read-aloud mode
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
import { log } from '../shared/logger.js';
import { setPhase, setModuleStatus, setTimeline, updateTimelineItem, addTimelineItem, setQueueState, recordError, recordTiming, resetPhase } from '../shared/state-tracker.js';

// ── Message helpers ────────────────────────────────────────────────────────

function toPopup(type, extra = {}) {
  chrome.runtime.sendMessage({ target: 'popup', type, ...extra });
}

function toBackground(type, extra = {}) {
  chrome.runtime.sendMessage({ target: 'background', type, ...extra }).catch(() => {});
}

function toContent(type, extra = {}) {
  chrome.runtime.sendMessage({ target: 'content', type, ...extra }).catch(() => {});
}

// ── Scheduler timing callback ──────────────────────────────────────────────

let chunkTexts = [];
let hasAnnouncedPlaying = false;

setTimingCallback(({ index, startTime, duration }) => {
  const chunkText = chunkTexts[index];

  // Streaming mode: send block highlight
  if (stream.active && stream.blockMap.has(index)) {
    if (!hasAnnouncedPlaying) {
      hasAnnouncedPlaying = true;
      toPopup(MSG.STATUS_PLAYING);
    }
    toContent(MSG.HIGHLIGHT_BLOCK, { blockIndex: index });
    return;
  }

  // Manual mode: send chunk highlight
  if (!chunkText) return;
  if (!hasAnnouncedPlaying) {
    hasAnnouncedPlaying = true;
    toPopup(MSG.STATUS_PLAYING);
  }
  toContent(MSG.HIGHLIGHT_CHUNK, {
    chunkIndex: index,
    chunkText,
    startTime,
    duration
  });
});

// ── Manual mode state ──────────────────────────────────────────────────────

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

// ── Streaming mode state ───────────────────────────────────────────────────

const stream = {
  active: false,
  isPaused: false,
  textBuffer: [],       // { index, text } blocks waiting for TTS
  audioQueue: [],       // { index, buffer, playbackRate } ready to play
  currentBlockIndex: 0, // what's currently playing
  blockMap: new Map(),  // index → text (for timing callback)
  settings: { model: null, voice: null, speed: 1, useGPU: false },
  ended: false,         // received isLastBlock
  synthesizing: false,  // prevent concurrent synthesis
  schedulerIndex: 0,    // next slot in scheduler
};

const TEXT_BUFFER_TARGET = 5;  // keep 5 blocks ahead
const AUDIO_BUFFER_TARGET = 1; // pre-generate 1 block ahead

// ── Main message handler ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen') return;

  // ── Streaming: receive block from content ──
  if (message.type === MSG.TTS_BUFFER) {
    handleStreamBuffer(message.block);
    return;
  }

  // ── Manual mode: one-shot generation ──
  if (message.type === MSG.TTS_GENERATE) {
    // Stop any active stream first
    if (stream.active) stopStream();
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
    return;
  }

  // ── Pause ──
  if (message.type === MSG.TTS_PAUSE) {
    log('offscreen', 'log', 'Pause requested');
    if (stream.active && !stream.isPaused) {
      stream.isPaused = true;
      pauseScheduler();
      toPopup(MSG.STATUS_PAUSED);
      return;
    }
    if (!pb.isPaused && pb.active) {
      pb.isPaused = true;
      pauseScheduler();
      setPhase('paused', { nextSentence: pb.nextIndex, total: pb.totalChunks });
      toPopup(MSG.STATUS_PAUSED);
    }
    return;
  }

  // ── Resume ──
  if (message.type === MSG.TTS_RESUME) {
    log('offscreen', 'log', 'Resume requested');
    if (stream.active && stream.isPaused) {
      stream.isPaused = false;
      resumeScheduler();
      streamSynthesisPump();
      toPopup(MSG.STATUS_PLAYING);
      return;
    }
    if (pb.isPaused && pb.active) {
      pb.isPaused = false;
      resumeScheduler();
      startSynthesisPump();
      setPhase('playing', { model: pb.model, totalChunks: pb.totalChunks });
      toPopup(MSG.STATUS_PLAYING);
    }
    return;
  }

  // ── Skip forward (manual mode only for now) ──
  if (message.type === MSG.TTS_SKIP_FORWARD) {
    if (stream.active) {
      // TODO: streaming skip
      log('offscreen', 'warn', 'Skip forward not yet implemented in streaming mode');
      return;
    }
    if (pb.active && pb.sentences.length > 0) {
      const currentSentence = Math.floor(getNextPlayIndex() / 2);
      const target = Math.min(currentSentence + 1, pb.totalChunks - 1);
      skipToChunk(target * 2);
      toContent(MSG.HIGHLIGHT_CHUNK, { chunkIndex: target * 2, chunkText: pb.sentences[target] });
    }
    return;
  }

  // ── Skip backward (manual mode only for now) ──
  if (message.type === MSG.TTS_SKIP_BACKWARD) {
    if (stream.active) {
      log('offscreen', 'warn', 'Skip backward not yet implemented in streaming mode');
      return;
    }
    if (pb.active && pb.sentences.length > 0) {
      const currentSentence = Math.floor(getNextPlayIndex() / 2);
      const target = Math.max(currentSentence - 1, 0);
      skipToChunk(target * 2);
      toContent(MSG.HIGHLIGHT_CHUNK, { chunkIndex: target * 2, chunkText: pb.sentences[target] });
    }
    return;
  }

  // ── Stop ──
  if (message.type === MSG.TTS_STOP) {
    log('offscreen', 'log', 'Stop requested');
    if (stream.active) {
      stopStream();
      return;
    }
    pb.active = false;
    pb.isPaused = false;
    setPhase('stopped');
    setModuleStatus('offscreen', 'idle');
    chunkTexts = [];
    hasAnnouncedPlaying = false;
    resetScheduler();
    toContent(MSG.CLEAR_HIGHLIGHTS);
    return;
  }
});

// ── Streaming handlers ─────────────────────────────────────────────────────

async function handleStreamBuffer(block) {
  if (!block || !block.text) return;

  // First block: initialize stream (must complete before synthesis)
  if (!stream.active) {
    await initStream(block);
  }

  log('offscreen', 'log', `Stream buffer received block ${block.index}, len=${block.text.length}`);
  stream.textBuffer.push({ index: block.index, text: block.text });
  stream.blockMap.set(block.index, block.text);

  if (block.isLastBlock) {
    stream.ended = true;
    log('offscreen', 'log', 'Stream end marker received');
  }

  // Start synthesis if not already running
  if (!stream.synthesizing) {
    streamSynthesisPump();
  }
}

async function initStream(firstBlock) {
  log('offscreen', 'log', '=== STREAM START ===');
  stream.active = true;
  stream.isPaused = false;
  stream.ended = false;
  stream.synthesizing = false;
  stream.textBuffer = [];
  stream.audioQueue = [];
  stream.blockMap = new Map();
  stream.schedulerIndex = 0;
  chunkTexts = [];
  hasAnnouncedPlaying = false;

  resetScheduler();
  await resetPhase();
  setPhase('start', { mode: 'stream' });
  setModuleStatus('offscreen', 'busy');
  toPopup(MSG.STATUS_GENERATING);

  // Load default settings
  const { getSettings } = await import('../shared/storage.js');
  const settings = await getSettings();
  stream.settings = {
    model: settings.defaultModel,
    voice: settings.defaultVoice || '3922',
    speed: Number(settings.defaultSpeed) || 1.0,
    useGPU: settings.executionProvider === 'webgpu'
  };

  try {
    await loadViaWorker(stream.settings.model, stream.settings.useGPU);
    await resumeAudioContext();
  } catch (e) {
    log('offscreen', 'error', 'Stream init failed:', e.message);
    recordError('offscreen', e.message);
    stopStream();
  }
}

async function streamSynthesisPump() {
  if (!stream.active || stream.isPaused || stream.synthesizing) return;

  // If no text to synthesize, check if we need more from content
  if (stream.textBuffer.length === 0) {
    if (!stream.ended) {
      requestNextBlock();
    } else if (stream.audioQueue.length === 0) {
      // All done
      finishStream();
    }
    return;
  }

  stream.synthesizing = true;

  try {
    const { index, text } = stream.textBuffer.shift();
    const { model, voice, speed, useGPU } = stream.settings;

    log('offscreen', 'log', `Synthesizing block ${index}, ${text.length} chars`);
    const start = performance.now();
    const { audio, sampleRate, playbackRate } = await inferViaWorker(model, text, voice, speed);
    const elapsed = Math.round(performance.now() - start);
    recordTiming(`stream_block_${index}`, elapsed);

    const buffer = createAudioBuffer(new Float32Array(audio), sampleRate);
    const schedIdx = stream.schedulerIndex++;

    enqueueChunk(schedIdx, buffer, playbackRate);
    chunkTexts[schedIdx] = text;

    // Add pause between blocks
    if (!stream.ended || stream.textBuffer.length > 0 || stream.audioQueue.length > 0) {
      enqueuePause(stream.schedulerIndex++, 0.5 / speed);
    }

    log('offscreen', 'log', `Block ${index} enqueued at scheduler ${schedIdx}`);

  } catch (e) {
    log('offscreen', 'error', 'Stream synthesis failed:', e.message);
    recordError('offscreen', `Stream: ${e.message}`);
  } finally {
    stream.synthesizing = false;
  }

  // Keep pumping if there's more work
  if (stream.textBuffer.length > 0) {
    streamSynthesisPump();
  } else if (!stream.ended) {
    requestNextBlock();
  } else if (stream.schedulerIndex > getNextPlayIndex()) {
    // Audio is queued, scheduler will play it. We're done generating.
    log('offscreen', 'log', 'All stream audio generated, playing out');
  } else {
    finishStream();
  }
}

function requestNextBlock() {
  if (stream.ended) return;
  const nextIndex = stream.textBuffer.length > 0
    ? stream.textBuffer[stream.textBuffer.length - 1].index + 1
    : 0;
  log('offscreen', 'log', 'Requesting next block:', nextIndex);
  toBackground(MSG.STATUS_NEED_BLOCK, { nextBlockIndex: nextIndex });
}

function finishStream() {
  log('offscreen', 'log', '=== STREAM END ===');
  setPhase('done');
  toPopup(MSG.STATUS_DONE);
  toPopup(MSG.STREAM_END);
  setModuleStatus('offscreen', 'idle');
  stream.active = false;
}

function stopStream() {
  log('offscreen', 'log', 'Stream stopped');
  stream.active = false;
  stream.isPaused = false;
  stream.textBuffer = [];
  stream.audioQueue = [];
  stream.blockMap.clear();
  chunkTexts = [];
  hasAnnouncedPlaying = false;
  resetScheduler();
  toContent(MSG.CLEAR_HIGHLIGHTS);
  setPhase('stopped');
  setModuleStatus('offscreen', 'idle');
}

// ── Manual mode: one-shot generation ───────────────────────────────────────

async function handleGenerate({ text, model, voice, speed, useGPU }) {
  log('offscreen', 'log', '=== GENERATE START ===');
  log('offscreen', 'log', 'Model:', model, '| Voice:', voice, '| Speed:', speed, '| GPU:', useGPU);
  log('offscreen', 'log', 'Text length:', text.length, 'chars');

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
    await loadViaWorker(model, useGPU);
    recordTiming('modelLoad', performance.now() - loadStart);
    updateTimelineItem(`Load model: ${model}${useGPU ? ' (GPU)' : ''}`, { status: 'done', durationMs: Math.round(performance.now() - loadStart) });

    await resumeAudioContext();

    setPhase('generating', { model, currentChunk: 0, totalChunks: 1 });
    const { splitIntoSentences } = await import('../shared/sentence-splitter.js');
    const sentences = splitIntoSentences(text);
    log('offscreen', 'log', 'Split into', sentences.length, 'sentences');

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

    const chunks = sentences;
    const totalChunks = chunks.length;
    const paraMap = buildParagraphMap(text, chunks);
    log('offscreen', 'log', 'Chunked into', totalChunks, 'sentence-level chunks');

    chunks.forEach((c, i) => { chunkTexts[i * 2] = c; });

    const timeline = chunks.map((_, i) => ({
      label: `Synthesize chunk ${i + 1}/${totalChunks}`,
      status: 'pending'
    }));
    timeline.push({ label: 'Playback', status: 'pending' });
    await setTimeline(timeline);
    await setQueueState({ totalChunks, completedChunks: 0, scheduledIndex: 0, queueSize: 0 });

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

    startSynthesisPump();

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

function getPauseDuration(chunkText, isLastChunk, speed = 1.0) {
  if (isLastChunk) return 0;
  const trimmed = chunkText.trimEnd();
  let pause = 0.3;
  if (trimmed.endsWith('\n')) pause = 0.8;
  else if (/[.!?]+$/.test(trimmed)) pause = 0.5;
  else if (/[,;:\-–—]+$/.test(trimmed)) pause = 0.25;
  else if (trimmed.endsWith('...')) pause = 0.5;
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

log('offscreen', 'log', 'Offscreen document initialized');
chrome.runtime.sendMessage({ target: 'background', type: MSG.OFFSCREEN_READY });
console.log('[TTS Studio DEBUG] Offscreen READY message sent');
