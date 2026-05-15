/**
 * Debug panel — shows logs from all extension modules.
 * Toggle with the 🐛 button in the header.
 */

const MAX_DISPLAYED = 100;

let panelEl = null;
let logListEl = null;
let isVisible = false;

/**
 * Create the debug panel DOM (hidden by default).
 */
export function createDebugPanel(container) {
  if (document.getElementById('tts-debug-panel')) return;

  panelEl = document.createElement('div');
  panelEl.id = 'tts-debug-panel';
  panelEl.style.cssText = `
    display: none;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 200px;
    background: #0a0a14;
    border-top: 1px solid #2a2a48;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: #a0a0b8;
    z-index: 100;
    flex-direction: column;
  `;

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-bottom: 1px solid #1f1f38;
    background: #0f0f1c;
  `;
  toolbar.innerHTML = `
    <span style="color:#6b6b8f;font-size:9px;">🐛 DEBUG</span>
    <button id="debug-clear" style="background:none;border:1px solid #2a2a48;color:#6b6b8f;font-size:9px;padding:2px 6px;border-radius:4px;cursor:pointer;">Clear</button>
    <button id="debug-copy" style="background:none;border:1px solid #2a2a48;color:#6b6b8f;font-size:9px;padding:2px 6px;border-radius:4px;cursor:pointer;">Copy All</button>
    <span id="debug-count" style="margin-left:auto;color:#3a3a5c;font-size:9px;">0 logs</span>
  `;

  // Log list
  logListEl = document.createElement('div');
  logListEl.id = 'tts-debug-logs';
  logListEl.style.cssText = `
    flex: 1;
    overflow-y: auto;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  `;

  panelEl.appendChild(toolbar);
  panelEl.appendChild(logListEl);
  container.appendChild(panelEl);

  // Event handlers
  toolbar.querySelector('#debug-clear').addEventListener('click', clearLogs);
  toolbar.querySelector('#debug-copy').addEventListener('click', copyAllLogs);
}

/**
 * Toggle visibility of the debug panel.
 */
export function toggleDebugPanel() {
  isVisible = !isVisible;
  if (panelEl) {
    panelEl.style.display = isVisible ? 'flex' : 'none';
  }
  return isVisible;
}

/**
 * Add a log entry to the panel.
 */
export function addLog(entry) {
  if (!logListEl) return;

  const row = document.createElement('div');
  row.style.cssText = `
    display: flex;
    gap: 6px;
    align-items: baseline;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `;

  const color = entry.level === 'error' ? '#ef4444'
    : entry.level === 'warn' ? '#fbbf24'
    : '#a0a0b8';

  const sourceColor = {
    bg: '#22d3ee',
    content: '#a78bfa',
    offscreen: '#4ade80',
    popup: '#f472b6'
  }[entry.source] || '#6b6b8f';

  row.innerHTML = `
    <span style="color:#3a3a5c;min-width:70px;flex-shrink:0;">${entry.timestamp}</span>
    <span style="color:${sourceColor};min-width:55px;flex-shrink:0;font-weight:600;">${entry.source}</span>
    <span style="color:${color};flex:1;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(entry.message)}</span>
  `;

  logListEl.appendChild(row);

  // Trim old logs
  while (logListEl.children.length > MAX_DISPLAYED) {
    logListEl.removeChild(logListEl.firstChild);
  }

  // Auto-scroll to bottom
  logListEl.scrollTop = logListEl.scrollHeight;

  // Update count
  const countEl = document.getElementById('debug-count');
  if (countEl) countEl.textContent = `${logListEl.children.length} logs`;
}

function clearLogs() {
  if (logListEl) logListEl.innerHTML = '';
  const countEl = document.getElementById('debug-count');
  if (countEl) countEl.textContent = '0 logs';
  chrome.storage.session.remove('tts_debug_logs').catch(() => {});
}

function copyAllLogs() {
  if (!logListEl) return;
  const lines = Array.from(logListEl.children).map(row => row.textContent.trim());
  navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
