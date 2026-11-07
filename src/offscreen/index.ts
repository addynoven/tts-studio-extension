/**
 * Offscreen Document — Entry Point
 * The engine room for WASM inference and Web Audio API playback.
 */

// Filter out benign third-party library warnings to keep Chrome's extension manager error tab pristine
const _origConsoleWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (args.some(a => typeof a === 'string' && a.includes('Unable to determine content-length'))) {
    return;
  }
  _origConsoleWarn.apply(console, args);
};

import { MSG, defaultVoiceForModel } from '../shared/constants.js';
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
  setTimingCallback,
  setWordTimingCallback,
  setPlaybackCompleteCallback,
  setQueueDrained,
  setPlaybackRate
} from './audio/scheduler.js';
import { loadModel, generateAudio, type TTSResult } from './tts/index.js';
import { log } from '../shared/logger.js';
import {
  setPhase,
  setModuleStatus,
  setTimeline,
  updateTimelineItem,
  addTimelineItem,
  setQueueState,
  recordError,
  recordTiming,
  resetPhase
} from '../shared/state-tracker.js';
import { getSettings, onSettingsChanged } from '../shared/storage.js';

// ── Web Worker for ONNX inference ──────────────────────────────────────────

const WORKER_URL = chrome.runtime.getURL('tts-worker/tts-worker.js');
let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<number, { resolve: (val: TTSResult | { loaded: true }) => void; reject: (err: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(WORKER_URL, { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; type: string; error?: string; audio?: Float32Array; sampleRate?: number; playbackRate?: number }>) => {
      const { id, type, error, ...result } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (type === 'error') {
        p.reject(new Error(error || 'Worker error'));
      } else if (type === 'loaded') {
        p.resolve({ loaded: true });
      } else {
        p.resolve(result as unknown as TTSResult);
      }
    };
    worker.onerror = (e) => {
      log('offscreen', 'error', 'Worker error:', e.message);
    };
  }
  return worker;
}

function postToWorker(type: string, payload: Record<string, unknown>): Promise<TTSResult | { loaded: true }> {
  return new Promise((resolve, reject) => {
    const id = ++nextRequestId;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, type, ...payload });
  });
}

async function loadViaWorker(model: string, useGPU = false): Promise<void> {
  const wasmPaths = typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL('transformers/')
    : undefined;
  try {
    await postToWorker('load', { model, useGPU, wasmPaths });
  } catch (e) {
    log('offscreen', 'warn', 'Worker load failed, falling back to direct:', (e as Error).message);
    await loadModel(model, null, useGPU);
  }
}

function terminateWorker(): void {
  if (worker) {
    try {
      worker.terminate();
    } catch {}
    worker = null;
  }
  for (const [id, p] of pending.entries()) {
    p.reject(new Error('Worker terminated'));
  }
  pending.clear();
}

async function inferViaWorker(model: string, text: string, voice: string, speed: number): Promise<TTSResult> {
  try {
    const res = await postToWorker('infer', { model, text, voice, speed });
    return res as TTSResult;
  } catch (e) {
    log('offscreen', 'error', 'Worker infer failed:', (e as Error).message);
    // If worker crashes from Vulkan/WebGPU memory exhaustion, terminate it to force Dawn to free GPU buffers!
    terminateWorker();
    throw e;
  }
}

// ── Message helpers ────────────────────────────────────────────────────────

function toPopup(type: string, extra: Record<string, unknown> = {}): void {
  chrome.runtime.sendMessage({ target: 'popup', type, ...extra }).catch(() => {});
}

function toBackground(type: string, extra: Record<string, unknown> = {}): void {
  chrome.runtime.sendMessage({ target: 'background', type, ...extra }).catch(() => {});
}

function toContent(type: string, extra: Record<string, unknown> = {}): void {
  chrome.runtime.sendMessage({ target: 'content', type, ...extra }).catch(() => {});
}

// ── State ──────────────────────────────────────────────────────────────────

let chunkTexts: string[] = [];
let hasAnnouncedPlaying = false;
let currentGenerationId = 0;

interface ManualPlaybackState {
  generationId: number;
  active: boolean;
  isPaused: boolean;
  sentences: string[];
  paraMap: Map<string, boolean> | null;
  model: string;
  voice: string;
  speed: number;
  useGPU: boolean;
  nextIndex: number;
  totalChunks: number;
  completedCount: number;
  errorCount: number;
  runningCount: number;
  resolveDone: (() => void) | null;
}

const pb: ManualPlaybackState = {
  generationId: 0,
  active: false,
  isPaused: false,
  sentences: [],
  paraMap: null,
  model: 'kokoro',
  voice: 'af_heart',
  speed: 1,
  useGPU: true,
  nextIndex: 0,
  totalChunks: 0,
  completedCount: 0,
  errorCount: 0,
  runningCount: 0,
  resolveDone: null
};

interface StreamBlock {
  index: number;
  text: string;
  isLastBlock?: boolean;
}

interface StreamState {
  active: boolean;
  isPaused: boolean;
  textBuffer: StreamBlock[];
  audioQueue: Array<{ index: number; buffer: AudioBuffer; playbackRate: number }>;
  currentBlockIndex: number;
  blockMap: Map<number, string>;
  settings: { model: string; voice: string; speed: number; useGPU: boolean };
  ended: boolean;
  synthesizing: boolean;
  schedulerIndex: number;
}

const stream: StreamState = {
  active: false,
  isPaused: false,
  textBuffer: [],
  audioQueue: [],
  currentBlockIndex: 0,
  blockMap: new Map(),
  settings: { model: 'kokoro', voice: 'af_heart', speed: 1, useGPU: true },
  ended: false,
  synthesizing: false,
  schedulerIndex: 0
};

// ── Scheduler callbacks ────────────────────────────────────────────────────

setTimingCallback(({ index, semanticId, startTime, duration }) => {
  if (!hasAnnouncedPlaying) {
    hasAnnouncedPlaying = true;
    toPopup(MSG.STATUS_PLAYING);
  }

  // Streaming mode: highlight block by semantic ID
  if (stream.active && semanticId !== undefined) {
    toContent(MSG.HIGHLIGHT_BLOCK, { blockIndex: Number(semanticId) });
    return;
  }

  // Manual mode: highlight chunk by text
  const chunkText = chunkTexts[index];
  if (chunkText) {
    toContent(MSG.HIGHLIGHT_CHUNK, {
      chunkIndex: index,
      chunkText,
      startTime,
      duration
    });
  }
});

setWordTimingCallback(({ word, charIndex, charLength, semanticId }) => {
  toContent(MSG.HIGHLIGHT_WORD, {
    word,
    charIndex,
    charLength,
    semanticId
  });
});

setPlaybackCompleteCallback(() => {
  log('offscreen', 'log', '=== AUDIO PLAYBACK COMPLETE ===');
  if (stream.active) {
    finishStream();
    return;
  }

  if (pb.active) {
    pb.active = false;
    pb.isPaused = false;
    updateTimelineItem('Playback', { status: 'done' });
    setPhase('done');
    setModuleStatus('offscreen', 'idle');
    toPopup(MSG.STATUS_DONE);
    toContent(MSG.CLEAR_HIGHLIGHTS);
  }
});

// ── Main message handler ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen') return;
  log('offscreen', 'log', 'Offscreen received target message:', message.type);

  if (message.type === MSG.TTS_PREWARM) {
    log('offscreen', 'log', 'Pre-warming Kokoro neural engine in background...');
    getSettings().then((settings) => {
      const model = settings.defaultModel === 'native' ? 'native' : 'kokoro';
      if (model === 'kokoro') {
        const useGPU = settings.executionProvider === 'webgpu';
        loadViaWorker('kokoro', useGPU)
          .then(() => {
            log('offscreen', 'log', 'Kokoro neural engine pre-warmed successfully in memory');
            toBackground(MSG.OFFSCREEN_READY, { prewarmed: true });
          })
          .catch((e: Error) => {
            log('offscreen', 'warn', 'Pre-warm background load failed:', e.message);
          });
      }
    });
    return;
  }

  if (message.type === MSG.TTS_SPEED_CHANGE) {
    const newSpeed = Number(message.speed);
    if (!Number.isNaN(newSpeed) && newSpeed > 0) {
      log('offscreen', 'log', 'Speed change requested:', newSpeed);
      setPlaybackRate(newSpeed);
      if (pb.active) pb.speed = newSpeed;
      if (stream.active) stream.settings.speed = newSpeed;
    }
    return;
  }

  if (message.type === MSG.TTS_BUFFER) {
    void handleStreamBuffer(message.block as StreamBlock);
    return;
  }

  if (message.type === MSG.TTS_GENERATE) {
    if (stream.active) stopStream();
    setModuleStatus('offscreen', 'busy');
    handleGenerate(message as { text: string; model: string; voice: string; speed: number; useGPU: boolean })
      .catch((e: Error) => {
        log('offscreen', 'error', 'handleGenerate failed:', e.message);
        recordError('offscreen', e.message);
        setPhase('error', { message: e.message });
        setModuleStatus('offscreen', 'error');
        toPopup(MSG.STATUS_ERROR, { error: e.message });
      })
      .finally(() => {
        if (!pb.active && !stream.active) {
          setModuleStatus('offscreen', 'idle');
        }
      });
    return;
  }

  if (message.type === MSG.TTS_TOGGLE_PLAYBACK) {
    log('offscreen', 'log', 'Toggle playback requested');
    if (stream.active) {
      if (stream.isPaused) {
        stream.isPaused = false;
        resumeScheduler();
        void streamSynthesisPump();
        toPopup(MSG.STATUS_PLAYING);
        toContent(MSG.STATUS_PLAYING);
      } else {
        stream.isPaused = true;
        pauseScheduler();
        toPopup(MSG.STATUS_PAUSED);
        toContent(MSG.STATUS_PAUSED);
      }
      return;
    }
    if (pb.active) {
      if (pb.isPaused) {
        pb.isPaused = false;
        resumeScheduler();
        startSynthesisPump();
        setPhase('playing', { model: pb.model, totalChunks: pb.totalChunks });
        toPopup(MSG.STATUS_PLAYING);
        toContent(MSG.STATUS_PLAYING);
      } else {
        pb.isPaused = true;
        pauseScheduler();
        setPhase('paused', { nextSentence: pb.nextIndex, total: pb.totalChunks });
        toPopup(MSG.STATUS_PAUSED);
        toContent(MSG.STATUS_PAUSED);
      }
      return;
    }
    return;
  }

  if (message.type === MSG.TTS_PAUSE) {
    log('offscreen', 'log', 'Pause requested');
    if (stream.active && !stream.isPaused) {
      stream.isPaused = true;
      pauseScheduler();
      toPopup(MSG.STATUS_PAUSED);
      toContent(MSG.STATUS_PAUSED);
      return;
    }
    if (!pb.isPaused && pb.active) {
      pb.isPaused = true;
      pauseScheduler();
      setPhase('paused', { nextSentence: pb.nextIndex, total: pb.totalChunks });
      toPopup(MSG.STATUS_PAUSED);
      toContent(MSG.STATUS_PAUSED);
    }
    return;
  }

  if (message.type === MSG.TTS_RESUME) {
    log('offscreen', 'log', 'Resume requested');
    if (stream.active && stream.isPaused) {
      stream.isPaused = false;
      resumeScheduler();
      void streamSynthesisPump();
      toPopup(MSG.STATUS_PLAYING);
      toContent(MSG.STATUS_PLAYING);
      return;
    }
    if (pb.isPaused && pb.active) {
      pb.isPaused = false;
      resumeScheduler();
      startSynthesisPump();
      setPhase('playing', { model: pb.model, totalChunks: pb.totalChunks });
      toPopup(MSG.STATUS_PLAYING);
      toContent(MSG.STATUS_PLAYING);
    }
    return;
  }

  if (message.type === MSG.TTS_SKIP_FORWARD) {
    if (stream.active) {
      log('offscreen', 'warn', 'Skip forward in streaming mode requested');
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

  if (message.type === MSG.TTS_SKIP_BACKWARD) {
    if (stream.active) {
      log('offscreen', 'warn', 'Skip backward in streaming mode requested');
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

  if (message.type === MSG.TTS_STOP) {
    log('offscreen', 'log', 'Stop requested');
    currentGenerationId++;
    if (stream.active) {
      stopStream();
      toContent(MSG.STATUS_DONE);
      toPopup(MSG.STATUS_DONE);
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
    toContent(MSG.STATUS_DONE);
    toPopup(MSG.STATUS_DONE);
    return;
  }
});

// ── Streaming handlers ─────────────────────────────────────────────────────

async function handleStreamBuffer(block: StreamBlock): Promise<void> {
  if (!block || !block.text) return;

  if (!stream.active) {
    await initStream();
  }

  log('offscreen', 'log', `Stream buffer received block ${block.index}, len=${block.text.length}`);
  const { splitTextIntoTTSChunks } = await import('../shared/sentence-splitter.js');
  const subChunks = splitTextIntoTTSChunks(block.text, 140);
  for (const sub of subChunks) {
    stream.textBuffer.push({ index: block.index, text: sub });
  }
  stream.blockMap.set(block.index, block.text);

  if (block.isLastBlock) {
    stream.ended = true;
    log('offscreen', 'log', 'Stream end marker received');
  }

  if (!stream.synthesizing) {
    void streamSynthesisPump();
  }
}

async function initStream(): Promise<void> {
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

  const settings = await getSettings();
  stream.settings = {
    model: settings.defaultModel || 'kokoro',
    voice: settings.defaultVoice || defaultVoiceForModel(settings.defaultModel || 'kokoro'),
    speed: Number(settings.defaultSpeed) || 1.0,
    useGPU: settings.executionProvider === 'webgpu'
  };

  try {
    await loadViaWorker(stream.settings.model, stream.settings.useGPU);
    await resumeAudioContext();
  } catch (e) {
    log('offscreen', 'error', 'Stream init failed:', (e as Error).message);
    recordError('offscreen', (e as Error).message);
    stopStream();
  }
}

async function streamSynthesisPump(): Promise<void> {
  if (!stream.active || stream.isPaused || stream.synthesizing) return;

  if (stream.textBuffer.length === 0) {
    if (!stream.ended) {
      requestNextBlock();
    } else {
      setQueueDrained(true);
    }
    return;
  }

  stream.synthesizing = true;

  try {
    const item = stream.textBuffer.shift()!;
    const { index, text } = item;
    const { model, voice, speed } = stream.settings;

    log('offscreen', 'log', `Synthesizing block ${index}, ${text.length} chars`);
    const start = performance.now();
    const inferRes = await inferViaWorker(model, text, voice, speed);
    const { audio, sampleRate, playbackRate } = inferRes;
    const elapsed = Math.round(performance.now() - start);
    recordTiming(`stream_block_${index}`, elapsed);

    const buffer = createAudioBuffer(new Float32Array(audio), sampleRate);
    const schedIdx = stream.schedulerIndex++;

    // Enqueue chunk with semanticId set to original block.index and wordTimings
    enqueueChunk(schedIdx, buffer, playbackRate, index, inferRes.wordTimings);
    chunkTexts[schedIdx] = text;

    // Add pause between blocks
    if (!stream.ended || stream.textBuffer.length > 0) {
      enqueuePause(stream.schedulerIndex++, 0.5 / speed);
    }

    log('offscreen', 'log', `Block ${index} enqueued at scheduler ${schedIdx}`);

  } catch (e) {
    log('offscreen', 'error', 'Stream synthesis failed:', (e as Error).message);
    recordError('offscreen', `Stream: ${(e as Error).message}`);
  } finally {
    stream.synthesizing = false;
  }

  if (stream.textBuffer.length > 0) {
    void streamSynthesisPump();
  } else if (!stream.ended) {
    requestNextBlock();
  } else {
    setQueueDrained(true);
  }
}

function requestNextBlock(): void {
  if (stream.ended) return;
  const nextIndex = stream.textBuffer.length > 0
    ? stream.textBuffer[stream.textBuffer.length - 1].index + 1
    : stream.blockMap.size;
  log('offscreen', 'log', 'Requesting next block:', nextIndex);
  toBackground(MSG.STATUS_NEED_BLOCK, { nextBlockIndex: nextIndex });
}

function finishStream(): void {
  log('offscreen', 'log', '=== STREAM END ===');
  setPhase('done');
  toPopup(MSG.STATUS_DONE);
  toPopup(MSG.STREAM_END);
  setModuleStatus('offscreen', 'idle');
  toContent(MSG.CLEAR_HIGHLIGHTS);
  stream.active = false;
}

function stopStream(): void {
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

async function handleGenerate({ text, model, voice, speed, useGPU }: {
  text: string;
  model: string;
  voice: string;
  speed: number;
  useGPU: boolean;
}): Promise<void> {
  log('offscreen', 'log', '=== GENERATE START ===');
  log('offscreen', 'log', 'Model:', model, '| Voice:', voice, '| Speed:', speed, '| GPU:', useGPU);
  log('offscreen', 'log', 'Text length:', text.length, 'chars');

  currentGenerationId++;
  const genId = currentGenerationId;

  pb.generationId = genId;
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

  try {
    setPhase('loading', { model, useGPU });
    addTimelineItem({ label: `Load model: ${model}${useGPU ? ' (GPU)' : ''}`, status: 'running' });
    const loadStart = performance.now();
    await loadViaWorker(model, useGPU);
    recordTiming('modelLoad', performance.now() - loadStart);
    updateTimelineItem(`Load model: ${model}${useGPU ? ' (GPU)' : ''}`, {
      status: 'done',
      durationMs: Math.round(performance.now() - loadStart)
    });

    await resumeAudioContext();

    setPhase('generating', { model, currentChunk: 0, totalChunks: 1 });
    const { splitTextIntoTTSChunks } = await import('../shared/sentence-splitter.js');
    const chunks = splitTextIntoTTSChunks(text, 140);
    log('offscreen', 'log', 'Split into', chunks.length, 'chunks (<=140 chars each)');

    if (chunks.length === 0) {
      log('offscreen', 'error', 'No chunks found in text');
      recordError('offscreen', 'No text to synthesize');
      setPhase('error', { message: 'No text to synthesize' });
      toPopup(MSG.STATUS_ERROR, { error: 'No text to synthesize' });
      pb.active = false;
      return;
    }

    if (chunks.length === 1 && chunks[0].length <= 140) {
      log('offscreen', 'log', 'Single short chunk — direct synthesis');
      addTimelineItem({ label: 'Synthesize text', status: 'running' });
      const inferRes = await inferViaWorker(model, chunks[0], voice, speed);
      const { audio, sampleRate, playbackRate } = inferRes;
      const buffer = createAudioBuffer(new Float32Array(audio), sampleRate);
      chunkTexts[0] = chunks[0];
      enqueueChunk(0, buffer, playbackRate, 0, inferRes.wordTimings);
      setQueueDrained(true);
      updateTimelineItem('Synthesize text', { status: 'done' });
      log('offscreen', 'log', '=== SYNTHESIS COMPLETE (single) — audio playing ===');
      return;
    }

    const totalChunks = chunks.length;
    const paraMap = buildParagraphMap(text, chunks);
    log('offscreen', 'log', 'Chunked into', totalChunks, 'sequential chunks');

    chunks.forEach((c, i) => { chunkTexts[i * 2] = c; });

    const timeline = chunks.map((_, i) => ({
      label: `Synthesize chunk ${i + 1}/${totalChunks}`,
      status: 'pending' as const
    }));
    timeline.push({ label: 'Playback', status: 'pending' as const });
    await setTimeline(timeline);
    await setQueueState({ totalChunks, completedChunks: 0, scheduledIndex: 0, queueSize: 0 });

    pb.sentences = chunks;
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

  } catch (e) {
    log('offscreen', 'error', 'Top-level generate failed:', (e as Error).message);
    recordError('offscreen', (e as Error).message);
    setPhase('error', { message: (e as Error).message });
    toPopup(MSG.STATUS_ERROR, { error: (e as Error).message });
    pb.active = false;
    throw e;
  }
}

function checkSynthesisDone(): void {
  if (pb.completedCount + pb.errorCount >= pb.totalChunks) {
    log('offscreen', 'log', 'All chunks synthesized — playback playing out');
    setQueueDrained(true);
    updateTimelineItem('Playback', { status: 'running' });
  }
}

function startSynthesisPump(): void {
  const genId = pb.generationId;
  while (pb.runningCount < 1 && pb.nextIndex < pb.totalChunks && !pb.isPaused && pb.active) {
    const index = pb.nextIndex++;
    pb.runningCount++;
    const label = `Synthesize chunk ${index + 1}/${pb.totalChunks}`;
    updateTimelineItem(label, { status: 'running' });
    setPhase('generating', { model: pb.model, currentChunk: index, totalChunks: pb.totalChunks });
    log('offscreen', 'log', `Chunk[${index}] synthesizing...`);

    synthesizeChunk(index, label, genId)
      .then(() => {
        if (pb.generationId !== genId || !pb.active) return;
        pb.runningCount--;
        pb.completedCount++;
        setQueueState({ completedChunks: pb.completedCount });
        log('offscreen', 'log', `Progress: ${pb.completedCount}/${pb.totalChunks} chunks done`);
        checkSynthesisDone();
        if (pb.active && !pb.isPaused) {
          startSynthesisPump();
        }
      })
      .catch((e: Error) => {
        if (pb.generationId !== genId || !pb.active) return;
        pb.runningCount--;
        pb.errorCount++;
        log('offscreen', 'error', `Chunk[${index}] failed:`, e.message);
        recordError('offscreen', `Chunk[${index}]: ${e.message}`);
        updateTimelineItem(label, { status: 'error' });
        checkSynthesisDone();
        if (pb.active && !pb.isPaused) {
          startSynthesisPump();
        }
      });
  }
}

async function synthesizeChunk(index: number, label: string, genId: number): Promise<void> {
  const chunkText = pb.sentences[index];
  const startTime = performance.now();
  const inferRes = await inferViaWorker(pb.model, chunkText, pb.voice, pb.speed);
  if (pb.generationId !== genId || !pb.active) {
    log('offscreen', 'log', `Chunk[${index}] discarded due to aborted generation`);
    return;
  }
  const { audio, sampleRate, playbackRate } = inferRes;
  const elapsed = Math.round(performance.now() - startTime);
  recordTiming(`chunk_${index}`, elapsed);
  log('offscreen', 'log', `Chunk[${index}] synthesized in ${elapsed}ms, ${audio.length} samples @ ${sampleRate}Hz`);
  updateTimelineItem(label, { status: 'done', durationMs: elapsed });

  const buffer = createAudioBuffer(new Float32Array(audio), sampleRate);
  enqueueChunk(index * 2, buffer, playbackRate, index, inferRes.wordTimings);
  log('offscreen', 'log', `Chunk[${index}] enqueued at position ${index * 2}`);

  if (index < pb.totalChunks - 1) {
    const isParaBreak = pb.paraMap?.get(pb.sentences[index]) ?? false;
    const pauseDur = isParaBreak ? 0.8 / pb.speed : getPauseDuration(pb.sentences[index], false, pb.speed);
    enqueuePause(index * 2 + 1, pauseDur);
    log('offscreen', 'log', `Pause[${index}] enqueued: ${(pauseDur * 1000).toFixed(0)}ms (para=${isParaBreak})`);
  }
}

function getPauseDuration(chunkText: string, isLastChunk: boolean, speed = 1.0): number {
  if (isLastChunk) return 0;
  const trimmed = chunkText.trimEnd();
  let pause = 0.3;
  if (trimmed.endsWith('\n')) pause = 0.8;
  else if (/[.!?]+$/.test(trimmed)) pause = 0.5;
  else if (/[,;:\-–—]+$/.test(trimmed)) pause = 0.25;
  else if (trimmed.endsWith('...')) pause = 0.5;
  return pause / speed;
}

function buildParagraphMap(originalText: string, chunks: string[]): Map<string, boolean> {
  let offset = 0;
  const map = new Map<string, boolean>();
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
chrome.runtime.sendMessage({ target: 'background', type: MSG.OFFSCREEN_READY }).catch(() => {});
console.log('[TTS Studio DEBUG] Offscreen READY message sent');

// ── Live storage synchronization ──────────────────────────────────────────
onSettingsChanged((newSettings) => {
  const newSpeed = Number(newSettings.defaultSpeed);
  if (!Number.isNaN(newSpeed) && newSpeed > 0) {
    setPlaybackRate(newSpeed);
    if (pb.active) pb.speed = newSpeed;
    if (stream.active) stream.settings.speed = newSpeed;
  }
  if (stream.active) {
    if (newSettings.defaultVoice) stream.settings.voice = newSettings.defaultVoice;
    if (newSettings.defaultModel) stream.settings.model = newSettings.defaultModel;
    stream.settings.useGPU = newSettings.executionProvider === 'webgpu';
  }
});
