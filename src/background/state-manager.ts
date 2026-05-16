/**
 * Central state management via chrome.storage.
 * All modules read/write state through here.
 */

import { getPlayback, setPlayback, getHistory, addToHistory } from '../shared/storage.js';

/**
 * Listen for storage changes and broadcast to relevant modules.
 */
export function initStateSync(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    // Broadcast playback state changes to popup
    if (area === 'session' && changes.playback) {
      chrome.runtime.sendMessage({
        target: 'popup',
        type: 'PLAYBACK_STATE_CHANGED',
        state: changes.playback.newValue
      }).catch(() => {});
    }
  });
}

/**
 * Update playback progress.
 */
export async function updatePlaybackProgress(currentSentence: number, totalSentences: number, url: string): Promise<void> {
  await setPlayback({
    isPlaying: true,
    currentSentence,
    totalSentences,
    url
  });
}

/**
 * Mark playback as stopped.
 */
export async function stopPlayback(): Promise<void> {
  const current = await getPlayback();
  await setPlayback({ ...current, isPlaying: false });
}

/**
 * Save article to history.
 */
export async function saveToHistory(url: string, title: string, totalSentences: number, lastSentence = 0): Promise<void> {
  await addToHistory({ url, title, totalSentences, lastSentence });
}
