/**
 * Debug Dashboard — Visual system state monitor
 * Shows at a glance: module health, current phase, timeline, errors.
 * Lives inside the debug panel, above the raw log stream.
 */

import { getSystemState, type SystemStateView, type ModuleStatus } from '../../shared/state-tracker.js';

let dashboardEl: HTMLDivElement | null = null;
let refreshInterval: ReturnType<typeof setInterval> | null = null;

// ── Module dot colors ───────────────────────────────────────────────────────

const STATUS_COLORS: Record<ModuleStatus, string> = {
  idle: '#6b6b8f',
  active: '#22d3ee',
  busy: '#fbbf24',
  error: '#ef4444'
};

const STATUS_LABELS: Record<ModuleStatus, string> = {
  idle: 'Idle',
  active: 'Active',
  busy: 'Busy',
  error: 'Error'
};

// ── Create / destroy ────────────────────────────────────────────────────────

export function createDebugDashboard(container: HTMLElement): void {
  if (document.getElementById('tts-debug-dashboard')) return;

  dashboardEl = document.createElement('div');
  dashboardEl.id = 'tts-debug-dashboard';
  dashboardEl.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid #1f1f38;
    background: #0c0c18;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: #a0a0b8;
    min-height: 0;
    flex-shrink: 0;
  `;

  renderSkeleton();
  container.insertBefore(dashboardEl, container.children[1]); // after toolbar

  startRefreshing();
}

export function destroyDebugDashboard(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  if (dashboardEl) {
    dashboardEl.remove();
    dashboardEl = null;
  }
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderSkeleton(): void {
  dashboardEl!.innerHTML = `
    <div id="dash-modules" style="display:flex;gap:12px;align-items:center;">
      <span style="color:#3a3a5c;font-size:9px;">Modules:</span>
    </div>
    <div id="dash-phase" style="display:flex;gap:8px;align-items:center;font-size:11px;">
      <span style="color:#3a3a5c;">Phase:</span>
      <span style="color:#a0a0b8;">—</span>
    </div>
    <div id="dash-timing" style="display:flex;gap:8px;align-items:center;color:#6b6b8f;font-size:9px;">
      <span>Elapsed: —</span>
      <span id="dash-queue">Queue: —</span>
    </div>
    <div id="dash-issues" style="display:none;gap:8px;align-items:center;padding:2px 6px;border-radius:3px;background:#1a0a0a;border:1px solid #3a1515;">
    </div>
    <div id="dash-timeline" style="display:none;flex-direction:column;gap:2px;margin-top:2px;">
      <div style="color:#3a3a5c;font-size:9px;">Timeline:</div>
      <div id="dash-timeline-rows" style="display:flex;flex-direction:column;gap:1px;"></div>
    </div>
  `;
}

async function refresh(): Promise<void> {
  if (!dashboardEl) return;
  const state = await getSystemState();
  renderModules(state.moduleStatus);
  renderPhase(state.phase, state.phaseDetail, state.elapsedMs);
  renderTiming(state.elapsedMs, state.queue);
  renderIssues(state);
  renderTimeline(state.timeline);
}

function renderModules(moduleStatus: Record<string, ModuleStatus>): void {
  const container = dashboardEl!.querySelector('#dash-modules') as HTMLDivElement;
  // Keep the label, rebuild the rest
  const label = container.firstElementChild!;
  container.innerHTML = '';
  container.appendChild(label);

  const modules = [
    { key: 'bg', name: 'bg' },
    { key: 'offscreen', name: 'offscreen' },
    { key: 'content', name: 'content' }
  ];

  for (const mod of modules) {
    const status = moduleStatus[mod.key] || 'idle';
    const dot = document.createElement('span');
    dot.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 9px;
      color: ${STATUS_COLORS[status] || '#6b6b8f'};
    `;
    dot.innerHTML = `
      <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${STATUS_COLORS[status] || '#6b6b8f'};"></span>
      ${mod.name}
    `;
    dot.title = `${mod.key}: ${STATUS_LABELS[status] || status}`;
    container.appendChild(dot);
  }
}

function renderPhase(phase: string, detail: Record<string, unknown>, elapsedMs: number): void {
  const container = dashboardEl!.querySelector('#dash-phase') as HTMLDivElement;
  const label = container.querySelector('span:first-child')!;

  const phaseEmojis: Record<string, string> = {
    idle: '⚪',
    start: '🚀',
    loading: '📦',
    generating: '⚡',
    playing: '🔊',
    done: '✅',
    error: '❌',
    stopped: '🛑'
  };

  let text = `${phaseEmojis[phase] || '⚪'} ${phase}`;
  const currentChunk = detail.currentChunk as number | undefined;
  const totalChunks = detail.totalChunks as number | undefined;
  if (currentChunk !== undefined && totalChunks !== undefined) {
    text += ` — chunk ${currentChunk + 1}/${totalChunks}`;
  }
  if (detail.model) {
    text += ` (${detail.model})`;
  }

  container.innerHTML = '';
  container.appendChild(label);
  const value = document.createElement('span');
  value.style.color = phase === 'error' ? '#ef4444' : phase === 'done' ? '#4ade80' : '#d4d4e0';
  value.textContent = text;
  container.appendChild(value);
}

function renderTiming(elapsedMs: number, queue: { totalChunks: number; completedChunks: number; queueSize: number }): void {
  const container = dashboardEl!.querySelector('#dash-timing') as HTMLDivElement;
  const elapsedStr = elapsedMs > 0 ? `${(elapsedMs / 1000).toFixed(1)}s` : '—';
  const queueStr = queue.totalChunks > 0
    ? `${queue.completedChunks}/${queue.totalChunks} done, ${queue.queueSize} queued`
    : '—';
  container.innerHTML = `
    <span>Elapsed: ${elapsedStr}</span>
    <span>Queue: ${queueStr}</span>
  `;
}

function renderIssues(state: SystemStateView): void {
  const container = dashboardEl!.querySelector('#dash-issues') as HTMLDivElement;
  const parts: string[] = [];
  if (state.warningCount > 0) parts.push(`⚠️ ${state.warningCount} warning${state.warningCount > 1 ? 's' : ''}`);
  if (state.errorCount > 0) parts.push(`🔴 ${state.errorCount} error${state.errorCount > 1 ? 's' : ''}`);

  if (parts.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  let html = parts.join(' &nbsp;|&nbsp; ');

  // Show the latest error inline
  const lastError = state.errors[state.errors.length - 1];
  if (lastError) {
    html += `<span style="margin-left:auto;color:#ef4444;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(lastError.message)}">${escapeHtml(truncate(lastError.message, 40))}</span>`;
  }
  container.innerHTML = html;
}

function renderTimeline(timeline: SystemStateView['timeline']): void {
  const container = dashboardEl!.querySelector('#dash-timeline') as HTMLDivElement;
  const rows = dashboardEl!.querySelector('#dash-timeline-rows') as HTMLDivElement;

  if (!timeline || timeline.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  rows.innerHTML = '';

  for (const item of timeline) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:9px;';

    const icons: Record<string, string> = {
      done: '✓',
      running: '🔄',
      pending: '○',
      error: '✗'
    };
    const colors: Record<string, string> = {
      done: '#4ade80',
      running: '#fbbf24',
      pending: '#3a3a5c',
      error: '#ef4444'
    };

    const dur = item.durationMs ? ` (${item.durationMs}ms)` : '';
    row.innerHTML = `
      <span style="color:${colors[item.status] || '#6b6b8f'};min-width:12px;text-align:center;">${icons[item.status] || '○'}</span>
      <span style="color:${colors[item.status] || '#6b6b8f'};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.label)}${dur}</span>
    `;
    rows.appendChild(row);
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

function startRefreshing(): void {
  refresh(); // immediate
  refreshInterval = setInterval(refresh, 500); // every 500ms
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}
