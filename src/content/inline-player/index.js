/**
 * Inline floating player (injected onto web pages).
 *
 * TODO: Phase 2 — Implement floating mini-player.
 * For now, this is a stub that logs when initialized.
 */

const PLAYER_ID = 'tts-studio-inline-player';

export function injectPlayer() {
  if (document.getElementById(PLAYER_ID)) return;
  console.log('[TTS Studio] Inline player not yet implemented');
}

export function removePlayer() {
  const el = document.getElementById(PLAYER_ID);
  if (el) el.remove();
}
