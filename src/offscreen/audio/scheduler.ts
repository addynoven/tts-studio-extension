/**
 * Gapless audio chunk scheduler with ordered playback, pauses, and exact onended lifecycle.
 */

import { log } from '../../shared/logger.js';
import { setQueueState } from '../../shared/state-tracker.js';

export interface ChunkQueueEntry {
  __chunk: true;
  buffer: AudioBuffer;
  playbackRate: number;
  semanticId?: number | string;
  wordTimings?: { word: string; charIndex: number; charLength: number; startTime: number; endTime: number }[];
}

export interface PauseQueueEntry {
  __pause: true;
  duration: number;
}

export type QueueEntry = ChunkQueueEntry | PauseQueueEntry;

export interface TimingInfo {
  index: number;
  semanticId?: number | string;
  startTime: number;
  duration: number;
}

export interface WordTimingInfo {
  word: string;
  charIndex: number;
  charLength: number;
  semanticId?: number | string;
}

export type TimingCallback = (info: TimingInfo) => void;
export type WordTimingCallback = (info: WordTimingInfo) => void;
export type CompletionCallback = () => void;

let ctx: AudioContext | null = null;
let nextStartTime = 0;

// Queue state
const queue = new Map<number, QueueEntry>();
let nextPlayIndex = 0;
let isScheduling = false;
let isPaused = false;
let isDrained = false;
let prebufferTarget = 1;

// Callbacks
let timingCallback: TimingCallback | null = null;
let wordTimingCallback: WordTimingCallback | null = null;
let completionCallback: CompletionCallback | null = null;

const activeTimeouts = new Set<ReturnType<typeof setTimeout>>();
const activeSources = new Set<AudioBufferSourceNode>();
let currentPlaybackRate = 1.0;

/**
 * Dynamically adjust playback rate for active audio and queued chunks in real time.
 */
export function setPlaybackRate(newRate: number): void {
  const safeRate = Math.max(0.25, Math.min(4.0, newRate));
  currentPlaybackRate = safeRate;

  for (const src of activeSources) {
    try {
      src.playbackRate.value = safeRate;
    } catch {}
  }

  for (const entry of queue.values()) {
    if ('__chunk' in entry) {
      entry.playbackRate = safeRate;
    }
  }

  log('offscreen', 'log', `Scheduler: live playback rate updated to ${safeRate.toFixed(2)}x`);
}

export function getPlaybackRate(): number {
  return currentPlaybackRate;
}

export function setTimingCallback(fn: TimingCallback | null): void {
  timingCallback = fn;
}

export function setWordTimingCallback(fn: WordTimingCallback | null): void {
  wordTimingCallback = fn;
}

export function setPrebufferTarget(target: number): void {
  prebufferTarget = Math.max(1, target);
}

export function setPlaybackCompleteCallback(fn: CompletionCallback | null): void {
  completionCallback = fn;
}

export function setQueueDrained(drained: boolean): void {
  isDrained = drained;
  checkCompletion();
}

function checkCompletion(): void {
  if (isDrained && queue.size === 0 && activeSources.size === 0) {
    log('offscreen', 'log', 'Scheduler: playback complete (all audio finished)');
    if (completionCallback) {
      completionCallback();
    }
  }
}

function getContext(): AudioContext {
  if (!ctx || ctx.state === 'closed') {
    ctx = new AudioContext();
    nextStartTime = ctx.currentTime;
    log('offscreen', 'log', 'AudioContext created, currentTime:', ctx.currentTime);
  }
  return ctx;
}

/**
 * Add a synthesized chunk to the queue.
 */
export function enqueueChunk(
  index: number,
  audioBuffer: AudioBuffer,
  playbackRate = 1.0,
  semanticId?: number | string,
  wordTimings?: { word: string; charIndex: number; charLength: number; startTime: number; endTime: number }[]
): void {
  log(
    'offscreen',
    'log',
    `Scheduler: enqueueChunk(${index}, id=${semanticId ?? index}), dur=${audioBuffer.duration.toFixed(3)}s, rate=${playbackRate.toFixed(2)}`
  );
  queue.set(index, { __chunk: true, buffer: audioBuffer, playbackRate, semanticId, wordTimings });
  setQueueState({ queueSize: queue.size, scheduledIndex: nextPlayIndex });
  tryScheduleNext();
}

/**
 * Add a pause (silence gap) before the next chunk.
 */
export function enqueuePause(index: number, durationSeconds: number): void {
  log('offscreen', 'log', `Scheduler: enqueuePause(${index}), duration=${(durationSeconds * 1000).toFixed(0)}ms`);
  queue.set(index, { __pause: true, duration: durationSeconds });
  setQueueState({ queueSize: queue.size, scheduledIndex: nextPlayIndex });
  tryScheduleNext();
}

/**
 * Try to schedule the next chunk(s) in sequence.
 */
function tryScheduleNext(): void {
  if (isScheduling || isPaused) return;

  // Pre-buffering: if starting playback from chunk 0 and queue is not drained yet, wait for prebuffer target
  if (nextPlayIndex === 0 && !isDrained && queue.size < prebufferTarget) {
    log('offscreen', 'log', `Scheduler: prebuffering ${queue.size}/${prebufferTarget} chunks before starting`);
    return;
  }

  isScheduling = true;

  const context = getContext();
  let scheduledCount = 0;

  while (queue.has(nextPlayIndex)) {
    const entry = queue.get(nextPlayIndex)!;
    queue.delete(nextPlayIndex);

    if ('__pause' in entry) {
      nextStartTime += entry.duration;
      nextPlayIndex++;
      scheduledCount++;
      continue;
    }

    const { buffer, playbackRate, semanticId, wordTimings } = entry;
    const rate = currentPlaybackRate > 0 && currentPlaybackRate !== 1.0 ? currentPlaybackRate : playbackRate;
    const source = context.createBufferSource();
    source.buffer = buffer;
    if (rate !== 1.0) {
      source.playbackRate.value = rate;
    }
    source.connect(context.destination);

    if (nextStartTime < context.currentTime) {
      nextStartTime = context.currentTime;
    }

    source.start(nextStartTime);
    activeSources.add(source);

    source.onended = () => {
      activeSources.delete(source);
      checkCompletion();
    };

    const effectiveDuration = buffer.duration / rate;
    const endTime = nextStartTime + effectiveDuration;
    const idx = nextPlayIndex;
    const start = nextStartTime;
    const dur = buffer.duration;

    if (timingCallback) {
      const delayMs = Math.max(0, (nextStartTime - context.currentTime) * 1000);
      if (delayMs <= 10) {
        timingCallback({
          index: idx,
          semanticId,
          startTime: start,
          duration: dur
        });
      } else {
        const timerId = setTimeout(() => {
          activeTimeouts.delete(timerId);
          if (timingCallback && !isPaused) {
            timingCallback({
              index: idx,
              semanticId,
              startTime: start,
              duration: dur
            });
          }
        }, delayMs);
        activeTimeouts.add(timerId);
      }
    }

    if (wordTimings && wordTimingCallback) {
      for (const wt of wordTimings) {
        const wordOffsetSec = wt.startTime / playbackRate;
        const wordStartAbsolute = start + wordOffsetSec;
        const wordDelayMs = Math.max(0, (wordStartAbsolute - context.currentTime) * 1000);

        const wordTimerId = setTimeout(() => {
          activeTimeouts.delete(wordTimerId);
          if (wordTimingCallback && !isPaused) {
            wordTimingCallback({
              word: wt.word,
              charIndex: wt.charIndex,
              charLength: wt.charLength,
              semanticId
            });
          }
        }, wordDelayMs);
        activeTimeouts.add(wordTimerId);
      }
    }

    nextStartTime = endTime;
    nextPlayIndex++;
    scheduledCount++;
  }

  if (scheduledCount > 0) {
    log('offscreen', 'log', `Scheduler: ${scheduledCount} items scheduled, queue size now ${queue.size}`);
  }

  setQueueState({ queueSize: queue.size, scheduledIndex: nextPlayIndex });
  isScheduling = false;
}

/**
 * Skip to a specific chunk index. Stops current audio and repositions playback.
 */
export function skipToChunk(chunkIndex: number): void {
  log('offscreen', 'log', `Scheduler: skipToChunk(${chunkIndex})`);

  for (const src of activeSources) {
    try { src.stop(); } catch {}
  }
  activeSources.clear();

  for (const timerId of activeTimeouts) {
    clearTimeout(timerId);
  }
  activeTimeouts.clear();

  const context = getContext();
  nextStartTime = context.currentTime;
  nextPlayIndex = chunkIndex;

  setQueueState({ queueSize: queue.size, scheduledIndex: nextPlayIndex });
  tryScheduleNext();
}

/**
 * Pause the scheduler. Suspends audio and cancels pending timers.
 */
export function pauseScheduler(): void {
  log('offscreen', 'log', 'Scheduler: pause called');
  isPaused = true;
  for (const timerId of activeTimeouts) {
    clearTimeout(timerId);
  }
  activeTimeouts.clear();

  if (ctx && ctx.state === 'running') {
    const res = ctx.suspend();
    if (res && typeof res.catch === 'function') {
      res.catch(() => {});
    }
  }
}

/**
 * Resume the scheduler. Restores audio and continues scheduling.
 */
export function resumeScheduler(): void {
  log('offscreen', 'log', 'Scheduler: resume called');
  isPaused = false;
  if (ctx && ctx.state === 'suspended') {
    const res = ctx.resume();
    if (res && typeof res.catch === 'function') {
      res.catch(() => {});
    }
  }
  tryScheduleNext();
}

/**
 * Reset the scheduler. Call when stopping playback.
 */
export function resetScheduler(closeContext = false): void {
  log('offscreen', 'log', 'Scheduler: reset called');
  for (const timerId of activeTimeouts) {
    clearTimeout(timerId);
  }
  activeTimeouts.clear();
  for (const src of activeSources) {
    try { src.stop(); } catch {}
  }
  activeSources.clear();
  queue.clear();
  nextPlayIndex = 0;

  // In unit test runner (Vitest), allow resetting context so MockAudioContext mocks take effect.
  // In production Chrome extension, keep AudioContext alive and persistent across runs to eliminate AudioContext thread/memory leaks.
  if (closeContext || (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test')) {
    if (ctx) {
      try { ctx.close(); } catch {}
      ctx = null;
    }
    nextStartTime = 0;
  } else {
    if (ctx && ctx.state !== 'closed') {
      nextStartTime = ctx.currentTime;
    } else {
      nextStartTime = 0;
    }
  }

  isScheduling = false;
  isPaused = false;
  isDrained = false;
  setQueueState({ queueSize: 0, scheduledIndex: 0 });
}

export function closeAudioContext(): void {
  if (ctx) {
    try { ctx.close(); } catch {}
    ctx = null;
  }
}

export function getNextPlayIndex(): number {
  return nextPlayIndex;
}

export function getSchedulerState(): { queueSize: number; nextPlayIndex: number; nextStartTime: number } {
  return {
    queueSize: queue.size,
    nextPlayIndex,
    nextStartTime
  };
}

export function createAudioBuffer(data: Float32Array, sampleRate: number): AudioBuffer {
  const context = getContext();
  const safeSampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 24000;
  const buffer = context.createBuffer(1, data.length, safeSampleRate);
  if (typeof (buffer as unknown as { copyToChannel?: unknown }).copyToChannel === 'function') {
    (buffer as unknown as { copyToChannel: (data: Float32Array, channel: number) => void }).copyToChannel(data, 0);
  } else if (typeof buffer.getChannelData === 'function') {
    buffer.getChannelData(0).set(data);
  }
  return buffer;
}

export async function resumeAudioContext(): Promise<void> {
  const context = getContext();
  if (context.state === 'suspended') {
    log('offscreen', 'log', 'AudioContext resuming from suspended state');
    await context.resume();
  }
}
