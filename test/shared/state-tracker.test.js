import { describe, it, expect, vi } from 'vitest';
import {
  setPhase,
  resetPhase,
  setModuleStatus,
  setTimeline,
  updateTimelineItem,
  addTimelineItem,
  setQueueState,
  recordError,
  recordWarning,
  recordTiming,
  getSystemState
} from '../../src/shared/state-tracker.js';
import { getStored } from '../setup.js';

const STATE_KEY = 'tts_system_state';

describe('state-tracker', () => {
  describe('setPhase', () => {
    it('stores phase and detail', async () => {
      await setPhase('loading', { model: 'kokoro' });
      const state = getStored(STATE_KEY);
      expect(state.phase).toBe('loading');
      expect(state.phaseDetail).toEqual({ model: 'kokoro' });
    });

    it('sets startTime on first call', async () => {
      await setPhase('start');
      const state = getStored(STATE_KEY);
      expect(state.timing.startTime).toBeTypeOf('number');
      expect(state.timing.startTime).toBeLessThanOrEqual(Date.now());
    });

    it('updates lastEventTime on each call', async () => {
      await setPhase('start');
      const before = getStored(STATE_KEY).timing.lastEventTime;
      await new Promise(r => setTimeout(r, 10));
      await setPhase('loading');
      const after = getStored(STATE_KEY).timing.lastEventTime;
      expect(after).toBeGreaterThan(before);
    });
  });

  describe('resetPhase', () => {
    it('clears everything back to defaults', async () => {
      await setPhase('loading', { model: 'kokoro' });
      await setModuleStatus('offscreen', 'busy');
      await recordError('offscreen', 'boom');
      await resetPhase();
      const state = getStored(STATE_KEY);
      expect(state.phase).toBe('idle');
      expect(state.errors).toEqual([]);
      expect(state.moduleStatus.offscreen).toBe('idle');
      expect(state.timing.startTime).toBeNull();
    });
  });

  describe('setModuleStatus', () => {
    it('updates individual module status', async () => {
      await setModuleStatus('offscreen', 'busy');
      await setModuleStatus('bg', 'active');
      const state = getStored(STATE_KEY);
      expect(state.moduleStatus.offscreen).toBe('busy');
      expect(state.moduleStatus.bg).toBe('active');
    });

    it('ignores invalid statuses', async () => {
      // Initialize state first so we have something to check
      await setModuleStatus('offscreen', 'idle');
      await setModuleStatus('offscreen', 'invalid');
      const state = getStored(STATE_KEY);
      expect(state.moduleStatus.offscreen).toBe('idle'); // unchanged
    });
  });

  describe('timeline', () => {
    it('setTimeline replaces entire timeline', async () => {
      await setTimeline([
        { label: 'Load', status: 'done' },
        { label: 'Synth', status: 'running' }
      ]);
      const state = getStored(STATE_KEY);
      expect(state.timeline).toHaveLength(2);
      expect(state.timeline[0].status).toBe('done');
    });

    it('updateTimelineItem patches by label', async () => {
      await setTimeline([{ label: 'Load', status: 'running' }]);
      await updateTimelineItem('Load', { status: 'done', durationMs: 100 });
      const state = getStored(STATE_KEY);
      expect(state.timeline[0].status).toBe('done');
      expect(state.timeline[0].durationMs).toBe(100);
    });

    it('addTimelineItem appends', async () => {
      await setTimeline([{ label: 'Load', status: 'done' }]);
      await addTimelineItem({ label: 'Synth', status: 'pending' });
      const state = getStored(STATE_KEY);
      expect(state.timeline).toHaveLength(2);
    });
  });

  describe('setQueueState', () => {
    it('merges queue patch', async () => {
      await setQueueState({ totalChunks: 5, completedChunks: 2 });
      const state = getStored(STATE_KEY);
      expect(state.queue.totalChunks).toBe(5);
      expect(state.queue.completedChunks).toBe(2);
    });
  });

  describe('recordError', () => {
    it('stores errors with source and message', async () => {
      await recordError('offscreen', 'model failed');
      const state = getStored(STATE_KEY);
      expect(state.errors).toHaveLength(1);
      expect(state.errors[0].source).toBe('offscreen');
      expect(state.errors[0].message).toBe('model failed');
      expect(state.errors[0].time).toBeTypeOf('number');
    });

    it('keeps only last 5 errors', async () => {
      for (let i = 0; i < 7; i++) {
        await recordError('offscreen', `error ${i}`);
      }
      const state = getStored(STATE_KEY);
      expect(state.errors).toHaveLength(5);
      expect(state.errors[4].message).toBe('error 6');
    });
  });

  describe('recordWarning', () => {
    it('stores warnings separately from errors', async () => {
      await recordWarning('bg', 'slow connection');
      const state = getStored(STATE_KEY);
      expect(state.warnings).toHaveLength(1);
      expect(state.warnings[0].message).toBe('slow connection');
    });
  });

  describe('recordTiming', () => {
    it('stores timing by label', async () => {
      await recordTiming('modelLoad', 850);
      const state = getStored(STATE_KEY);
      expect(state.timing.modelLoad).toBe(850);
    });
  });

  describe('getSystemState', () => {
    it('computes elapsedMs from startTime', async () => {
      await setPhase('loading');
      await new Promise(r => setTimeout(r, 50));
      const state = await getSystemState();
      expect(state.elapsedMs).toBeGreaterThanOrEqual(40);
      expect(state.elapsedMs).toBeLessThan(200);
    });

    it('computes timeline counts', async () => {
      await setTimeline([
        { label: 'A', status: 'done' },
        { label: 'B', status: 'running' },
        { label: 'C', status: 'pending' }
      ]);
      const state = await getSystemState();
      expect(state.timelineDone).toBe(1);
      expect(state.timelineRunning).toBe(1);
      expect(state.errorCount).toBe(0);
    });

    it('returns defaults when storage is empty', async () => {
      const state = await getSystemState();
      expect(state.phase).toBe('idle');
      expect(state.elapsedMs).toBe(0);
    });
  });
});
