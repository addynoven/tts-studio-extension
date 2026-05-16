/**
 * Status bar, progress, and waveform components.
 */

const statusDot = document.getElementById('statusDot') as HTMLDivElement;
const statusText = document.getElementById('statusText') as HTMLDivElement;
const progressWrap = document.getElementById('progressWrap') as HTMLDivElement;
const progressFill = document.getElementById('progressFill') as HTMLDivElement;
const waveform = document.getElementById('waveform') as HTMLDivElement;
const btnCopyStatus = document.getElementById('btnCopyStatus') as HTMLButtonElement;

export type StatusState = 'idle' | 'loading' | 'generating' | 'playing' | 'paused' | 'error' | 'ready';

/**
 * Set the status state and message.
 */
export function setStatus(state: StatusState, text: string): void {
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
 */
export function updateProgress(percent: number): void {
  progressFill.classList.remove('indeterminate');
  progressFill.style.width = percent + '%';
}

/**
 * Initialize copy button.
 */
export function initCopyButton(): void {
  btnCopyStatus.addEventListener('click', async () => {
    const text = statusText.textContent || '';
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

function showCopiedFeedback(): void {
  const original = btnCopyStatus.textContent;
  btnCopyStatus.textContent = '✓';
  setTimeout(() => btnCopyStatus.textContent = original, 1200);
}
