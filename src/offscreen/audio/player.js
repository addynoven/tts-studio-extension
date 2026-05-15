/**
 * Web Audio API playback.
 * Simple AudioBufferSourceNode playback for now.
 * Gapless scheduling will be added in Phase 2.
 */

let audioCtx = null;
let audioSource = null;

function getAudioCtx() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

/**
 * Play a Float32Array as audio.
 * @param {Float32Array} audioData
 * @param {number} sampleRate
 * @returns {Promise<void>} Resolves when playback finishes
 */
export async function playFloat32(audioData, sampleRate) {
  const ctx = getAudioCtx();
  const buffer = ctx.createBuffer(1, audioData.length, sampleRate);
  buffer.copyToChannel(audioData, 0);

  // Stop any currently playing audio
  if (audioSource) {
    try { audioSource.stop(); } catch {}
  }

  audioSource = ctx.createBufferSource();
  audioSource.buffer = buffer;
  audioSource.connect(ctx.destination);

  return new Promise((resolve) => {
    audioSource.onended = resolve;
    audioSource.start();
  });
}

/**
 * Stop currently playing audio immediately.
 */
export function stopAudio() {
  if (audioSource) {
    try { audioSource.stop(); } catch {}
    audioSource = null;
  }
}

/**
 * Resume the audio context (needed after user gesture).
 */
export async function resumeAudio() {
  const ctx = getAudioCtx();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
}
