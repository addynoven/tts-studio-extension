import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  enqueueChunk,
  enqueuePause,
  resetScheduler,
  getSchedulerState,
  createAudioBuffer,
  skipToChunk,
  pauseScheduler,
  resumeScheduler,
  getNextPlayIndex,
  resumeAudioContext,
  setTimingCallback
} from '../../src/offscreen/audio/scheduler.js';

class MockAudioBuffer {
  constructor(options) {
    this.duration = options.length / options.sampleRate;
    this.sampleRate = options.sampleRate;
    this.numberOfChannels = options.numberOfChannels || 1;
    this.length = options.length;
    this._data = new Float32Array(options.length);
  }
  copyToChannel(data) {
    this._data.set(data);
  }
}

class MockBufferSource {
  constructor() {
    this.buffer = null;
    this._connected = null;
    this._startTime = null;
    this.playbackRate = { value: 1.0 };
    this._stopped = false;
  }
  connect(dest) { this._connected = dest; }
  start(when) { this._startTime = when; }
  stop() { this._stopped = true; }
  set onended(fn) { if (fn) setTimeout(fn, 10); }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = { name: 'destination' };
    this.state = 'running';
    this._suspended = false;
  }
  createBuffer(numberOfChannels, length, sampleRate) {
    return new MockAudioBuffer({ numberOfChannels, length, sampleRate });
  }
  createBufferSource() {
    return new MockBufferSource();
  }
  resume() { this._suspended = false; this.state = 'running'; return Promise.resolve(); }
  suspend() { this._suspended = true; this.state = 'suspended'; }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

beforeEach(() => {
  global.AudioContext = MockAudioContext;
  resetScheduler();
});

afterEach(() => {
  resetScheduler();
});

describe('scheduler advanced', () => {
  describe('skipToChunk', () => {
    it('stops active sources and resets position', () => {
      const buf = new MockAudioBuffer({ length: 24000, sampleRate: 24000 });
      enqueueChunk(0, buf);
      enqueueChunk(1, buf);

      skipToChunk(1);
      const state = getSchedulerState();
      expect(state.nextPlayIndex).toBe(1);
    });

    it('clears pending timing callbacks', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const timingFn = vi.fn();
      setTimingCallback(timingFn);

      const ctx = new MockAudioContext();
      global.AudioContext = function() { return ctx; };
      resetScheduler();

      const buf = new MockAudioBuffer({ length: 24000, sampleRate: 24000 });
      enqueueChunk(0, buf); // fires immediately
      timingFn.mockClear();

      enqueueChunk(1, buf); // scheduled at t=1, delayMs=1000
      skipToChunk(0); // clears pending timeouts

      vi.advanceTimersByTime(2000);
      expect(timingFn).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('pauseScheduler / resumeScheduler', () => {
    it('pauses and resumes AudioContext', () => {
      const ctx = new MockAudioContext();
      global.AudioContext = function() { return ctx; };
      resetScheduler();

      const buf = new MockAudioBuffer({ length: 24000, sampleRate: 24000 });
      enqueueChunk(0, buf);

      pauseScheduler();
      expect(ctx.state).toBe('suspended');

      resumeScheduler();
      expect(ctx.state).toBe('running');
    });

    it('does not schedule new chunks while paused', () => {
      pauseScheduler();
      const buf = new MockAudioBuffer({ length: 24000, sampleRate: 24000 });
      enqueueChunk(0, buf);
      const state = getSchedulerState();
      expect(state.queueSize).toBe(1);
    });

    it('resumes scheduling after resume', () => {
      const ctx = new MockAudioContext();
      global.AudioContext = function() { return ctx; };
      resetScheduler();

      pauseScheduler();
      const buf = new MockAudioBuffer({ length: 24000, sampleRate: 24000 });
      enqueueChunk(0, buf);
      expect(getSchedulerState().queueSize).toBe(1);

      resumeScheduler();
      expect(getSchedulerState().queueSize).toBe(0);
      expect(getSchedulerState().nextPlayIndex).toBe(1);
    });
  });

  describe('getNextPlayIndex', () => {
    it('returns 0 initially', () => {
      expect(getNextPlayIndex()).toBe(0);
    });

    it('advances after scheduling chunks', () => {
      const buf = new MockAudioBuffer({ length: 24000, sampleRate: 24000 });
      enqueueChunk(0, buf);
      expect(getNextPlayIndex()).toBe(1);
    });
  });

  describe('resumeAudioContext', () => {
    it('resumes suspended context', async () => {
      const ctx = new MockAudioContext();
      ctx.state = 'suspended';
      global.AudioContext = function() { return ctx; };
      resetScheduler();

      await resumeAudioContext();
      expect(ctx.state).toBe('running');
    });

    it('does nothing if context is already running', async () => {
      const ctx = new MockAudioContext();
      global.AudioContext = function() { return ctx; };
      resetScheduler();

      await resumeAudioContext();
      expect(ctx.state).toBe('running');
    });
  });

  describe('setTimingCallback', () => {
    it('fires timing callback immediately for past chunks', () => {
      const timingFn = vi.fn();
      setTimingCallback(timingFn);

      const buf = new MockAudioBuffer({ length: 24000, sampleRate: 24000 });
      enqueueChunk(0, buf);

      expect(timingFn).toHaveBeenCalledWith(
        expect.objectContaining({ index: 0, duration: 1 })
      );
    });

    it('schedules timing callback via setTimeout for future chunks', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const timingFn = vi.fn();
      setTimingCallback(timingFn);

      const ctx = new MockAudioContext();
      ctx.currentTime = 0;
      global.AudioContext = function() { return ctx; };
      resetScheduler();

      const buf = new MockAudioBuffer({ length: 24000, sampleRate: 24000 });
      enqueueChunk(0, buf); // fires immediately at t=0
      timingFn.mockClear();

      enqueueChunk(1, buf); // scheduled at t=1, delayMs=1000

      expect(timingFn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(timingFn).toHaveBeenCalledWith(
        expect.objectContaining({ index: 1 })
      );

      vi.useRealTimers();
    });
  });

  describe('playback rate', () => {
    it('applies playbackRate to buffer source', () => {
      const ctx = new MockAudioContext();
      global.AudioContext = function() { return ctx; };
      resetScheduler();

      const buf = new MockAudioBuffer({ length: 24000, sampleRate: 24000 });
      enqueueChunk(0, buf, 1.5);

      const state = getSchedulerState();
      expect(state.nextStartTime).toBeCloseTo(1 / 1.5, 2);
    });
  });
});
