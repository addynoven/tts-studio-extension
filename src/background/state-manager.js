/**
 * Central state management via chrome.storage.
 * All modules read/write state through here.
 */

import { getPlayback, setPlayback, getHistory, addToHistory } from '../shared/storage.js';

/**
 * Listen for storage changes and broadcast to relevant modules.
 */
export function initStateSync() {
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
export async function updatePlaybackProgress(currentSentence, totalSentences, url) {
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
export async function stopPlayback() {
  const current = await getPlayback();
  await setPlayback({ ...current, isPlaying: false });
}

/**
 * Save article to history.
 */
export async function saveToHistory(url, title, totalSentences, lastSentence = 0) {
  await addToHistory({ url, title, totalSentences, lastSentence });
}
