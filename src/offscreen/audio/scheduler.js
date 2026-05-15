/**
 * Gapless audio chunk scheduler with ordered playback and pauses.
 *
 * Problem: TTS synthesis is async. Sentence 2 might finish before sentence 1.
 * We must play them in TEXT order, not completion order, with natural pauses.
 *
 * Solution: Indexed queue. Chunks are stored by index. The scheduler only
 * schedules the next index in sequence. Unscheduled chunks wait their turn.
 * Pause "buffers" are just time advances — no silent audio needed.
 */

import { log } from '../../shared/logger.js';
import { setQueueState } from '../../shared/state-tracker.js';

let ctx = null;
let nextStartTime = 0;

// Queue state
const queue = new Map();        // index -> AudioBuffer | { __pause: true, duration }
let nextPlayIndex = 0;          // which index should play next
let isScheduling = false;       // prevent re-entrant scheduling

// Timing callback — called when a chunk actually starts playing
let timingCallback = null;
const activeTimeouts = new Set();

export function setTimingCallback(fn) {
  timingCallback = fn;
}

function getContext() {
  if (!ctx) {
    ctx = new AudioContext();
    nextStartTime = ctx.currentTime;
    log('offscreen', 'log', 'AudioContext created, currentTime:', ctx.currentTime);
  }
  return ctx;
}

/**
 * Add a synthesized chunk to the queue.
 * It will be scheduled for playback when its turn comes.
 *
 * @param {number} index - Sentence/chunk index (0-based, in text order)
 * @param {AudioBuffer} audioBuffer
 */
export function enqueueChunk(index, audioBuffer) {
  log('offscreen', 'log', `Scheduler: enqueueChunk(${index}), duration=${audioBuffer.duration.toFixed(3)}s`);
  queue.set(index, audioBuffer);
  setQueueState({ queueSize: queue.size, scheduledIndex: nextPlayIndex });
  tryScheduleNext();
}

/**
 * Add a pause (silence gap) before the next chunk.
 * This is stored as a "virtual" buffer — just a duration advance.
 * @param {number} index - Position in queue (use half-index like 0.5 for pauses)
 * @param {number} durationSeconds
 */
export function enqueuePause(index, durationSeconds) {
  log('offscreen', 'log', `Scheduler: enqueuePause(${index}), duration=${(durationSeconds * 1000).toFixed(0)}ms`);
  queue.set(index, { __pause: true, duration: durationSeconds });
  setQueueState({ queueSize: queue.size, scheduledIndex: nextPlayIndex });
  tryScheduleNext();
}

/**
 * Try to schedule the next chunk(s) in sequence.
 * Called whenever a new chunk arrives OR when playback advances.
 */
function tryScheduleNext() {
  if (isScheduling) return;
  isScheduling = true;

  const context = getContext();
  let scheduledCount = 0;

  // Schedule all consecutive ready chunks starting from nextPlayIndex
  while (queue.has(nextPlayIndex)) {
    const entry = queue.get(nextPlayIndex);
    queue.delete(nextPlayIndex);

    if (entry && entry.__pause) {
      // Pause: just advance the clock
      nextStartTime += entry.duration;
      log('offscreen', 'log', `Scheduler: pause scheduled, nextStartTime advanced by ${(entry.duration * 1000).toFixed(0)}ms`);
      nextPlayIndex++;
      scheduledCount++;
      continue;
    }

    const buffer = entry;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    // Ensure we don't schedule in the past
    if (nextStartTime < context.currentTime) {
      log('offscreen', 'warn', `Scheduler: nextStartTime (${nextStartTime.toFixed(3)}) is in the past, resetting to currentTime (${context.currentTime.toFixed(3)})`);
      nextStartTime = context.currentTime;
    }

    source.start(nextStartTime);
    const endTime = nextStartTime + buffer.duration;
    log('offscreen', 'log', `Scheduler: chunk ${nextPlayIndex} scheduled @ ${nextStartTime.toFixed(3)}s → ${endTime.toFixed(3)}s`);

    // Notify about timing
    if (timingCallback) {
      const delayMs = Math.max(0, (nextStartTime - context.currentTime) * 1000);
      const idx = nextPlayIndex;
      const start = nextStartTime;
      const dur = buffer.duration;
      
      if (delayMs <= 0) {
        timingCallback({
          index: idx,
          startTime: start,
          duration: dur
        });
      } else {
        const timerId = setTimeout(() => {
          activeTimeouts.delete(timerId);
          if (timingCallback) {
            timingCallback({
              index: idx,
              startTime: start,
              duration: dur
            });
          }
        }, delayMs);
        activeTimeouts.add(timerId);
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
 * Reset the scheduler. Call when stopping playback or starting new article.
 */
export function resetScheduler() {
  log('offscreen', 'log', 'Scheduler: reset called');
  if (ctx) {
    try { ctx.close(); } catch {}
    ctx = null;
  }
  for (const timerId of activeTimeouts) {
    clearTimeout(timerId);
  }
  activeTimeouts.clear();
  queue.clear();
  nextPlayIndex = 0;
  nextStartTime = 0;
  isScheduling = false;
  setQueueState({ queueSize: 0, scheduledIndex: 0 });
}

/**
 * Get the current playback state.
 * @returns {{ queueSize: number, nextPlayIndex: number, nextStartTime: number }}
 */
export function getSchedulerState() {
  return {
    queueSize: queue.size,
    nextPlayIndex,
    nextStartTime
  };
}

/**
 * Create an AudioBuffer from Float32Array data.
 * @param {Float32Array} data
 * @param {number} sampleRate
 * @returns {AudioBuffer}
 */
export function createAudioBuffer(data, sampleRate) {
  const context = getContext();
  const buffer = context.createBuffer(1, data.length, sampleRate);
  buffer.copyToChannel(data, 0);
  return buffer;
}

/**
 * Pre-warm the audio context (needed after user gesture).
 */
export async function resumeAudioContext() {
  const context = getContext();
  if (context.state === 'suspended') {
    log('offscreen', 'log', 'AudioContext resuming from suspended state');
    await context.resume();
  }
}
