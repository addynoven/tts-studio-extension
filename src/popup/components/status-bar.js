/**
 * Status bar, progress, and waveform components.
 */

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const waveform = document.getElementById('waveform');
const btnCopyStatus = document.getElementById('btnCopyStatus');

/**
 * Set the status state and message.
 * @param {string} state - 'idle' | 'loading' | 'generating' | 'playing' | 'error' | 'ready'
 * @param {string} text
 */
export function setStatus(state, text) {
  statusDot.className = 'status-dot ' + state;
  statusText.textContent = text;

  const showProgress = state === 'loading' || state === 'generating';
  progressWrap.classList.toggle('visible', showProgress);
  if (showProgress) {
    progressFill.classList.add('indeterminate');
  } else {
    progressFill.classList.remove('indeterminate');
    progressFill.style.width = '0%';
  }

  if (state === 'playing') {
    waveform.classList.add('playing');
  } else {
    waveform.classList.remove('playing');
  }
}

/**
 * Update progress bar percentage.
 * @param {number} percent
 */
export function updateProgress(percent) {
  progressFill.classList.remove('indeterminate');
  progressFill.style.width = percent + '%';
}

/**
 * Initialize copy button.
 */
export function initCopyButton() {
  btnCopyStatus.addEventListener('click', async () => {
    const text = statusText.textContent;
    try {
      await navigator.clipboard.writeText(text);
      showCopiedFeedback();
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showCopiedFeedback();
    }
  });
}

function showCopiedFeedback() {
  const original = btnCopyStatus.textContent;
  btnCopyStatus.textContent = '✓';
  setTimeout(() => btnCopyStatus.textContent = original, 1200);
}
