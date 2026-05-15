import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  enqueueChunk,
  enqueuePause,
  resetScheduler,
  getSchedulerState,
  createAudioBuffer
} from '../../src/offscreen/audio/scheduler.js';

// Mock AudioContext for jsdom
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
  }
  connect(dest) { this._connected = dest; }
  start(when) { this._startTime = when; }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = { name: 'destination' };
    this.state = 'running';
  }
  createBuffer(numberOfChannels, length, sampleRate) {
    return new MockAudioBuffer({ numberOfChannels, length, sampleRate });
  }
  createBufferSource() {
    return new MockBufferSource();
  }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

beforeEach(() => {
  global.AudioContext = MockAudioContext;
  resetScheduler();
});

afterEach(() => {
  resetScheduler();
});

describe('scheduler', () => {
  describe('enqueueChunk', () => {
    it('stores buffer in queue', () => {
      const buffer = new MockAudioBuffer({ length: 48000, sampleRate: 24000 });
      enqueueChunk(0, buffer);
      const state = getSchedulerState();
      expect(state.queueSize).toBe(0); // scheduled immediately since index 0
    });

    it('schedules consecutive chunks in order', () => {
      const ctx = new MockAudioContext();
      global.AudioContext = function() { return ctx; };
      resetScheduler();

      const buf1 = new MockAudioBuffer({ length: 24000, sampleRate: 24000 }); // 1s
      const buf2 = new MockAudioBuffer({ length: 24000, sampleRate: 24000 }); // 1s

      enqueueChunk(0, buf1);
      enqueueChunk(1, buf2);

      const state = getSchedulerState();
      expect(state.nextPlayIndex).toBe(2);
      expect(state.nextStartTime).toBe(2); // 1s + 1s
    });

    it('queues out-of-order chunks until their turn', () => {
      const buf1 = new MockAudioBuffer({ length: 24000, sampleRate: 24000 });
      const buf2 = new MockAudioBuffer({ length: 24000, sampleRate: 24000 });

      enqueueChunk(1, buf2); // arrives first
      const state1 = getSchedulerState();
      expect(state1.queueSize).toBe(1); // waiting for index 0

      enqueueChunk(0, buf1); // now both can play
      const state2 = getSchedulerState();
      expect(state2.queueSize).toBe(0);
      expect(state2.nextPlayIndex).toBe(2);
    });
  });

  describe('enqueuePause', () => {
    it('advances nextStartTime without audio', () => {
      const buf = new MockAudioBuffer({ length: 24000, sampleRate: 24000 });
      enqueueChunk(0, buf);
      enqueuePause(1, 0.5); // 500ms pause

      const state = getSchedulerState();
      expect(state.nextPlayIndex).toBe(2);
      expect(state.nextStartTime).toBe(1.5); // 1s audio + 0.5s pause
    });
  });

  describe('resetScheduler', () => {
    it('clears queue and resets state', () => {
      const buf = new MockAudioBuffer({ length: 24000, sampleRate: 24000 });
      enqueueChunk(0, buf);
      resetScheduler();
      const state = getSchedulerState();
      expect(state.queueSize).toBe(0);
      expect(state.nextPlayIndex).toBe(0);
      expect(state.nextStartTime).toBe(0);
    });
  });

  describe('getSchedulerState', () => {
    it('returns correct initial state', () => {
      const state = getSchedulerState();
      expect(state.queueSize).toBe(0);
      expect(state.nextPlayIndex).toBe(0);
      expect(state.nextStartTime).toBe(0);
    });
  });

  describe('createAudioBuffer', () => {
    it('creates buffer from Float32Array', () => {
      const data = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const buffer = createAudioBuffer(data, 24000);
      expect(buffer.length).toBe(4);
      expect(buffer.sampleRate).toBe(24000);
    });
  });
});
