/**
 * System State Tracker
 * Tracks what the extension is doing right now, across all modules.
 * Stores state in chrome.storage.session so the popup can read it any time.
 *
 * Call setPhase() / setModuleStatus() / recordTiming() / recordError()
 * from anywhere. The popup reads these and renders a live dashboard.
 */

export type ModuleName = 'bg' | 'offscreen' | 'content' | 'popup';
export type ModuleStatus = 'idle' | 'active' | 'busy' | 'error';
export type Phase = string;

export interface TimelineItem {
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  durationMs?: number;
}

export interface QueueState {
  totalChunks: number;
  completedChunks: number;
  scheduledIndex: number;
  queueSize: number;
}

export interface StateError {
  source: string;
  message: string;
  time: number;
}

export interface SystemState {
  phase: Phase;
  phaseDetail: Record<string, unknown>;
  moduleStatus: Record<ModuleName, ModuleStatus>;
  timeline: TimelineItem[];
  errors: StateError[];
  warnings: StateError[];
  timing: Record<string, number | null>;
  queue: QueueState;
}

export interface SystemStateView extends SystemState {
  elapsedMs: number;
  timelineDone: number;
  timelineRunning: number;
  errorCount: number;
  warningCount: number;
}

const STATE_KEY = 'tts_system_state';

const DEFAULT_STATE: SystemState = {
  phase: 'idle',
  phaseDetail: {},
  moduleStatus: {
    bg: 'idle',
    offscreen: 'idle',
    content: 'idle',
    popup: 'idle'
  },
  timeline: [],
  errors: [],
  warnings: [],
  timing: {
    startTime: null,
    lastEventTime: null
  },
  queue: {
    totalChunks: 0,
    completedChunks: 0,
    scheduledIndex: 0,
    queueSize: 0
  }
};

// ── Phase management ────────────────────────────────────────────────────────

export async function setPhase(phase: Phase, detail: Record<string, unknown> = {}): Promise<void> {
  await mutateState(s => ({
    ...s,
    phase,
    phaseDetail: detail,
    timing: {
      ...s.timing,
      startTime: s.timing.startTime || Date.now(),
      lastEventTime: Date.now()
    }
  }));
}

export async function resetPhase(): Promise<void> {
  await mutateState(() => ({
    ...DEFAULT_STATE,
    timing: { startTime: null, lastEventTime: null }
  }));
}

// ── Module status ───────────────────────────────────────────────────────────

const VALID_STATUSES: ModuleStatus[] = ['idle', 'active', 'busy', 'error'];

export async function setModuleStatus(module: ModuleName, status: ModuleStatus): Promise<void> {
  if (!VALID_STATUSES.includes(status)) return;
  await mutateState(s => ({
    ...s,
    moduleStatus: { ...s.moduleStatus, [module]: status }
  }));
}

// ── Timeline / progress ─────────────────────────────────────────────────────

export async function setTimeline(timeline: TimelineItem[]): Promise<void> {
  await mutateState(s => ({ ...s, timeline }));
}

export async function updateTimelineItem(label: string, patch: Partial<TimelineItem>): Promise<void> {
  await mutateState(s => ({
    ...s,
    timeline: s.timeline.map(item =>
      item.label === label ? { ...item, ...patch } : item
    )
  }));
}

export async function addTimelineItem(item: TimelineItem): Promise<void> {
  await mutateState(s => ({
    ...s,
    timeline: [...s.timeline, item]
  }));
}

// ── Queue state (from scheduler) ────────────────────────────────────────────

export async function setQueueState(patch: Partial<QueueState>): Promise<void> {
  await mutateState(s => ({
    ...s,
    queue: { ...s.queue, ...patch }
  }));
}

// ── Errors & warnings ───────────────────────────────────────────────────────

export async function recordError(source: string, message: string): Promise<void> {
  await mutateState(s => ({
    ...s,
    errors: [...s.errors.slice(-4), { source, message, time: Date.now() }]
  }));
}

export async function recordWarning(source: string, message: string): Promise<void> {
  await mutateState(s => ({
    ...s,
    warnings: [...s.warnings.slice(-4), { source, message, time: Date.now() }]
  }));
}

// ── Timing ──────────────────────────────────────────────────────────────────

export async function recordTiming(label: string, durationMs: number): Promise<void> {
  await mutateState(s => ({
    ...s,
    timing: { ...s.timing, [label]: durationMs }
  }));
}

// ── Read state ──────────────────────────────────────────────────────────────

export async function getSystemState(): Promise<SystemStateView> {
  try {
    const { [STATE_KEY]: raw } = await chrome.storage.session.get(STATE_KEY);
    const state = (raw as SystemState) || { ...DEFAULT_STATE };
    // Compute derived values
    const elapsed = state.timing.startTime
      ? Date.now() - state.timing.startTime
      : 0;
    const doneCount = state.timeline.filter(t => t.status === 'done').length;
    const runningCount = state.timeline.filter(t => t.status === 'running').length;
    return {
      ...state,
      elapsedMs: elapsed,
      timelineDone: doneCount,
      timelineRunning: runningCount,
      errorCount: state.errors.length,
      warningCount: state.warnings.length
    };
  } catch {
    return {
      ...DEFAULT_STATE,
      elapsedMs: 0,
      timelineDone: 0,
      timelineRunning: 0,
      errorCount: 0,
      warningCount: 0
    };
  }
}

// ── Internal ────────────────────────────────────────────────────────────────

async function mutateState(fn: (state: SystemState) => SystemState): Promise<void> {
  try {
    const { [STATE_KEY]: raw } = await chrome.storage.session.get(STATE_KEY);
    const state = (raw as SystemState) || { ...DEFAULT_STATE };
    const next = fn(state);
    await chrome.storage.session.set({ [STATE_KEY]: next });
  } catch {
    // Storage unavailable
  }
}
