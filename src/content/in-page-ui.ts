/**
 * In-Page Ambient UI.
 * 1. Floating selection trigger ('🔊 Read') on text highlight.
 * 2. Draggable glassmorphic bottom pill player with playback controls.
 */

let selectionBtn: HTMLElement | null = null;
let miniPlayerEl: HTMLElement | null = null;
let currentSpeed = 1.0;
let isPlayingState = false;

export interface InPageUICallbacks {
  onReadSelection: (text: string) => void;
  onTogglePlay: () => void;
  onStop: () => void;
  onSkipForward: () => void;
  onSkipBackward: () => void;
  onSpeedChange: (speed: number) => void;
}

let callbacks: InPageUICallbacks | null = null;

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export function initInPageUI(cb: InPageUICallbacks): void {
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
      gap: 10px;
      padding: 8px 16px;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      border-radius: 9999px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.15);
      animation: tts-slide-up 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      user-select: none;
    }
    .tts-studio-mini-player button {
      background: transparent;
      border: none;
      color: #f8fafc;
      cursor: pointer;
      font-size: 13px;
      padding: 4px 8px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, opacity 0.15s ease;
    }
    .tts-studio-mini-player button:hover {
      background: rgba(255, 255, 255, 0.12);
    }
    .tts-studio-mini-player button:active {
      transform: scale(0.94);
    }
    .tts-studio-mini-player .tts-play-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #10b981;
      color: #0f172a;
      font-weight: 700;
    }
    .tts-studio-mini-player .tts-play-btn:hover {
      background: #34d399;
    }
    .tts-studio-speed-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 6px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.1);
      cursor: pointer;
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
  document.addEventListener('mouseup', (e) => {
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
  });

  document.addEventListener('mousedown', (e) => {
    if (selectionBtn && !selectionBtn.contains(e.target as Node)) {
      removeSelectionButton();
    }
  });
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
    showMiniPlayer();
    callbacks?.onReadSelection(text);
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

export function updateMiniPlayerState(state: { isPlaying?: boolean; speed?: number }): void {
  if (typeof state.isPlaying === 'boolean') {
    isPlayingState = state.isPlaying;
  }
  if (typeof state.speed === 'number') {
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

function renderMiniPlayerContent(): void {
  if (!miniPlayerEl) return;

  miniPlayerEl.innerHTML = `
    <button class="tts-prev-btn" title="Previous sentence">⏮</button>
    <button class="tts-play-btn" title="${isPlayingState ? 'Pause' : 'Play'}">
      ${isPlayingState ? '⏸' : '▶'}
    </button>
    <button class="tts-next-btn" title="Next sentence">⏭</button>
    <span class="tts-studio-speed-badge" title="Change speaking speed">${currentSpeed}×</span>
    <button class="tts-close-btn" title="Stop & close">✕</button>
  `;

  miniPlayerEl.querySelector('.tts-play-btn')?.addEventListener('click', () => {
    callbacks?.onTogglePlay();
  });
  miniPlayerEl.querySelector('.tts-prev-btn')?.addEventListener('click', () => {
    callbacks?.onSkipBackward();
  });
  miniPlayerEl.querySelector('.tts-next-btn')?.addEventListener('click', () => {
    callbacks?.onSkipForward();
  });
  miniPlayerEl.querySelector('.tts-close-btn')?.addEventListener('click', () => {
    callbacks?.onStop();
    hideMiniPlayer();
  });

  const speedBadge = miniPlayerEl.querySelector('.tts-studio-speed-badge');
  speedBadge?.addEventListener('click', () => {
    const curIdx = SPEEDS.indexOf(currentSpeed);
    const nextIdx = (curIdx + 1) % SPEEDS.length;
    currentSpeed = SPEEDS[nextIdx];
    callbacks?.onSpeedChange(currentSpeed);
    renderMiniPlayerContent();
  });
}
