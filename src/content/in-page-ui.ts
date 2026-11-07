/**
 * In-Page Ambient UI.
 * 1. Floating selection trigger ('🔊 Read') on text highlight.
 * 2. Draggable glassmorphic bottom pill player with playback controls.
 */

let selectionBtn: HTMLElement | null = null;
let miniPlayerEl: HTMLElement | null = null;
let currentSpeed = 1.0;
let isPlayingState = false;

let mouseupHandler: ((e: MouseEvent) => void) | null = null;
let mousedownHandler: ((e: MouseEvent) => void) | null = null;

export interface InPageUICallbacks {
  onReadSelection: (text: string) => void;
  onTogglePlay: () => void;
  onStop: () => void;
  onSkipForward: () => void;
  onSkipBackward: () => void;
  onSpeedChange: (speed: number) => void;
  onCopyTrackLog?: () => string;
}

let callbacks: InPageUICallbacks | null = null;

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

/**
 * Safely check if the extension runtime is still connected.
 */
export function isContextAlive(): boolean {
  try {
    return Boolean(typeof chrome !== 'undefined' && chrome.runtime && (chrome.runtime.id || chrome.runtime.sendMessage));
  } catch {
    return false;
  }
}

/**
 * Display a gentle toast if the user clicks UI on an orphaned page after extension reload.
 */
export function showReloadToast(): void {
  removeSelectionButton();
  hideMiniPlayer();
  if (document.getElementById('tts-studio-reload-toast')) return;

  const toast = document.createElement('div');
  toast.id = 'tts-studio-reload-toast';
  toast.className = 'tts-studio-reload-toast';
  toast.innerHTML = `<span>⚠️</span><span>TTS Studio was updated. Please refresh the page to read.</span>`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, 4500);
}

/**
 * Display a temporary floating toast message on the page.
 */
export function showInPageToast(message: string): void {
  const existing = document.getElementById('tts-studio-mini-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'tts-studio-mini-toast';
  toast.className = 'tts-studio-reload-toast';
  toast.style.background = '#0f172a';
  toast.style.border = '1px solid rgba(255, 255, 255, 0.15)';
  toast.style.bottom = '80px';
  toast.innerHTML = `<span>${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * Teardown in-page UI and event listeners (used on context invalidation or re-injection).
 */
export function teardownInPageUI(): void {
  removeSelectionButton();
  hideMiniPlayer();
  if (mouseupHandler) {
    document.removeEventListener('mouseup', mouseupHandler);
    mouseupHandler = null;
  }
  if (mousedownHandler) {
    document.removeEventListener('mousedown', mousedownHandler);
    mousedownHandler = null;
  }
}

export function initInPageUI(cb: InPageUICallbacks): void {
  teardownInPageUI();
  callbacks = cb;
  injectStyles();
  setupSelectionListener();
}

function injectStyles(): void {
  if (document.getElementById('tts-studio-inpage-styles')) return;

  const style = document.createElement('style');
  style.id = 'tts-studio-inpage-styles';
  style.textContent = `
    .tts-studio-float-btn {
      position: absolute;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      border-radius: 9999px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.1);
      cursor: pointer;
      user-select: none;
      animation: tts-pop-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
      transition: transform 0.1s ease, background 0.15s ease;
    }
    .tts-studio-float-btn:hover {
      background: #1e293b;
      transform: scale(1.04);
    }
    .tts-studio-float-btn:active {
      transform: scale(0.96);
    }

    .tts-studio-mini-player {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483646;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: rgba(10, 11, 16, 0.94);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      border-radius: 9999px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.12);
      animation: tts-slide-up 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      user-select: none;
    }
    .tts-studio-mini-player button {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 13px;
      padding: 6px 8px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
    }
    .tts-studio-mini-player button:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #f8fafc;
    }
    .tts-studio-mini-player button:active {
      transform: scale(0.92);
    }
    .tts-studio-mini-player .tts-play-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #10b981;
      color: #052e16;
      padding: 0;
    }
    .tts-studio-mini-player .tts-play-btn:hover {
      background: #34d399;
      color: #052e16;
    }
    .tts-studio-mini-player .tts-close-btn:hover {
      background: rgba(239, 68, 68, 0.2);
      color: #f87171;
    }
    .tts-studio-speed-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.08);
      color: #e2e8f0;
      border: 1px solid rgba(255, 255, 255, 0.08);
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .tts-studio-speed-badge:hover {
      background: rgba(255, 255, 255, 0.14);
      border-color: rgba(255, 255, 255, 0.18);
    }

    .tts-studio-reload-toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      border-radius: 9999px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.15);
      animation: tts-slide-up 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      transition: opacity 0.3s ease;
      user-select: none;
    }

    @keyframes tts-pop-in {
      from { opacity: 0; transform: scale(0.85); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes tts-slide-up {
      from { opacity: 0; transform: translate(-50%, 20px); }
      to { opacity: 1; transform: translate(-50%, 0); }
    }
  `;
  document.head.appendChild(style);
}

function setupSelectionListener(): void {
  mouseupHandler = (e: MouseEvent) => {
    // If runtime context has become invalid, tear down and stop listening
    if (!isContextAlive()) {
      teardownInPageUI();
      return;
    }

    // Ignore clicks inside mini-player or float button
    if (
      (selectionBtn && selectionBtn.contains(e.target as Node)) ||
      (miniPlayerEl && miniPlayerEl.contains(e.target as Node))
    ) {
      return;
    }

    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        removeSelectionButton();
        return;
      }

      const text = selection.toString().trim();
      if (text.length < 3) {
        removeSelectionButton();
        return;
      }

      // Check if selection is within an input or textarea
      const anchorNode = selection.anchorNode;
      const parentEl = anchorNode?.parentElement;
      if (parentEl && ['input', 'textarea'].includes(parentEl.tagName.toLowerCase())) {
        removeSelectionButton();
        return;
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        removeSelectionButton();
        return;
      }

      showSelectionButton(rect, text);
    }, 10);
  };

  mousedownHandler = (e: MouseEvent) => {
    if (selectionBtn && !selectionBtn.contains(e.target as Node)) {
      removeSelectionButton();
    }
  };

  document.addEventListener('mouseup', mouseupHandler);
  document.addEventListener('mousedown', mousedownHandler);
}

function showSelectionButton(rect: DOMRect, text: string): void {
  removeSelectionButton();

  selectionBtn = document.createElement('div');
  selectionBtn.className = 'tts-studio-float-btn';
  selectionBtn.innerHTML = `<span>🔊</span><span>Read</span>`;

  const top = window.scrollY + rect.top - 40;
  const left = window.scrollX + rect.left + rect.width / 2 - 35;

  selectionBtn.style.top = `${Math.max(10, top)}px`;
  selectionBtn.style.left = `${Math.max(10, left)}px`;

  selectionBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    removeSelectionButton();
    if (!isContextAlive()) {
      teardownInPageUI();
      showReloadToast();
      return;
    }
    showMiniPlayer();
    try {
      callbacks?.onReadSelection(text);
    } catch (err) {
      if ((err as Error)?.message?.includes('Extension context invalidated')) {
        teardownInPageUI();
        showReloadToast();
      }
    }
  });

  document.body.appendChild(selectionBtn);
}

function removeSelectionButton(): void {
  if (selectionBtn) {
    selectionBtn.remove();
    selectionBtn = null;
  }
}

export function showMiniPlayer(): void {
  if (miniPlayerEl) return;

  miniPlayerEl = document.createElement('div');
  miniPlayerEl.className = 'tts-studio-mini-player';
  renderMiniPlayerContent();
  document.body.appendChild(miniPlayerEl);
}

export function setCurrentSpeed(speed: number): void {
  if (typeof speed === 'number' && !Number.isNaN(speed) && speed > 0) {
    currentSpeed = speed;
    if (miniPlayerEl) {
      renderMiniPlayerContent();
    }
  }
}

export function updateMiniPlayerState(state: { isPlaying?: boolean; speed?: number }): void {
  if (typeof state.isPlaying === 'boolean') {
    isPlayingState = state.isPlaying;
  }
  if (typeof state.speed === 'number' && !Number.isNaN(state.speed) && state.speed > 0) {
    currentSpeed = state.speed;
  }
  if (miniPlayerEl) {
    renderMiniPlayerContent();
  }
}

export function hideMiniPlayer(): void {
  if (miniPlayerEl) {
    miniPlayerEl.remove();
    miniPlayerEl = null;
  }
}

function safeExecute(action: () => void): void {
  if (!isContextAlive()) {
    teardownInPageUI();
    showReloadToast();
    return;
  }
  try {
    action();
  } catch (err) {
    if ((err as Error)?.message?.includes('Extension context invalidated')) {
      teardownInPageUI();
      showReloadToast();
    }
  }
}

function renderMiniPlayerContent(): void {
  if (!miniPlayerEl) return;

  const playSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>`;
  const pauseSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
  const prevSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>`;
  const nextSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>`;
  const closeSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  const logSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>`;

  miniPlayerEl.innerHTML = `
    <button class="tts-prev-btn" title="Previous sentence">${prevSvg}</button>
    <button class="tts-play-btn" title="${isPlayingState ? 'Pause' : 'Play'}" aria-label="${isPlayingState ? 'Pause' : 'Play'}">
      ${isPlayingState ? pauseSvg : playSvg}
    </button>
    <button class="tts-next-btn" title="Next sentence">${nextSvg}</button>
    <span class="tts-studio-speed-badge" title="Change speaking speed">${currentSpeed}×</span>
    <button class="tts-log-btn" title="Copy Click-to-Read Trace Log" aria-label="Copy Trace Log">${logSvg}</button>
    <button class="tts-close-btn" title="Stop & close">${closeSvg}</button>
  `;

  miniPlayerEl.querySelector('.tts-play-btn')?.addEventListener('click', () => {
    safeExecute(() => callbacks?.onTogglePlay());
  });
  miniPlayerEl.querySelector('.tts-prev-btn')?.addEventListener('click', () => {
    safeExecute(() => callbacks?.onSkipBackward());
  });
  miniPlayerEl.querySelector('.tts-next-btn')?.addEventListener('click', () => {
    safeExecute(() => callbacks?.onSkipForward());
  });
  miniPlayerEl.querySelector('.tts-log-btn')?.addEventListener('click', async () => {
    const text = callbacks?.onCopyTrackLog?.() || 'No click/read trace logs recorded yet';
    try {
      await navigator.clipboard.writeText(text);
      showInPageToast('📋 Click-to-read track log copied to clipboard!');
    } catch {
      console.log('[TTS Tracker Log]\n' + text);
      showInPageToast('📋 Track log printed to DevTools Console!');
    }
  });
  miniPlayerEl.querySelector('.tts-close-btn')?.addEventListener('click', () => {
    safeExecute(() => callbacks?.onStop());
    hideMiniPlayer();
  });

  const speedBadge = miniPlayerEl.querySelector('.tts-studio-speed-badge');
  speedBadge?.addEventListener('click', () => {
    let curIdx = SPEEDS.findIndex(s => Math.abs(s - currentSpeed) < 0.05);
    if (curIdx === -1) curIdx = SPEEDS.indexOf(1.0);
    const nextIdx = (curIdx + 1) % SPEEDS.length;
    currentSpeed = SPEEDS[nextIdx];
    safeExecute(() => callbacks?.onSpeedChange(currentSpeed));
    renderMiniPlayerContent();
  });
}
