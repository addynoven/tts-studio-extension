import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initInPageUI,
  showMiniPlayer,
  updateMiniPlayerState,
  hideMiniPlayer
} from '../../src/content/in-page-ui.js';

describe('in-page-ui', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    const existing = document.getElementById('tts-studio-inpage-styles');
    if (existing) existing.remove();
  });

  afterEach(() => {
    hideMiniPlayer();
    document.body.innerHTML = '';
  });

  it('initializes in-page UI and injects stylesheet', () => {
    const cb = {
      onReadSelection: vi.fn(),
      onTogglePlay: vi.fn(),
      onStop: vi.fn(),
      onSkipForward: vi.fn(),
      onSkipBackward: vi.fn(),
      onSpeedChange: vi.fn()
    };
    initInPageUI(cb);
    expect(document.getElementById('tts-studio-inpage-styles')).not.toBeNull();
  });

  it('renders mini-player on demand and toggles play state', () => {
    const cb = {
      onReadSelection: vi.fn(),
      onTogglePlay: vi.fn(),
      onStop: vi.fn(),
      onSkipForward: vi.fn(),
      onSkipBackward: vi.fn(),
      onSpeedChange: vi.fn()
    };
    initInPageUI(cb);

    showMiniPlayer();
    const player = document.querySelector('.tts-studio-mini-player');
    expect(player).not.toBeNull();

    const playBtn = player?.querySelector('.tts-play-btn');
    expect(playBtn).not.toBeNull();
    playBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cb.onTogglePlay).toHaveBeenCalledTimes(1);

    updateMiniPlayerState({ isPlaying: true });
    expect(player?.querySelector('.tts-play-btn')?.textContent?.trim()).toBe('⏸');

    hideMiniPlayer();
    expect(document.querySelector('.tts-studio-mini-player')).toBeNull();
  });

  it('cycles through speed values', () => {
    const cb = {
      onReadSelection: vi.fn(),
      onTogglePlay: vi.fn(),
      onStop: vi.fn(),
      onSkipForward: vi.fn(),
      onSkipBackward: vi.fn(),
      onSpeedChange: vi.fn()
    };
    initInPageUI(cb);
    showMiniPlayer();

    const badge = document.querySelector('.tts-studio-speed-badge');
    expect(badge).not.toBeNull();
    badge?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(cb.onSpeedChange).toHaveBeenCalled();
  });
});
