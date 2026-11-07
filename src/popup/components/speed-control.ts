/**
 * Speed control component with discrete pills and fine slider.
 */

const speedSlider = document.getElementById('speedSlider') as HTMLInputElement | null;
const speedVal = document.getElementById('speedVal') as HTMLSpanElement | null;
const speedPills = document.querySelectorAll<HTMLButtonElement>('.speed-pill');

/**
 * Initialize speed control.
 */
export function initSpeedControl(initialValue: number | null, onChange: (speed: number) => void): void {
  const initial = initialValue != null && initialValue > 0 ? initialValue : 1.0;
  if (speedSlider) {
    speedSlider.value = String(initial);
  }
  updateDisplay(initial);

  speedSlider?.addEventListener('input', () => {
    const v = parseFloat(speedSlider.value);
    updateDisplay(v);
    onChange(v);
  });

  speedPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const v = parseFloat(pill.dataset.speed || '1.0');
      if (!Number.isNaN(v)) {
        if (speedSlider) speedSlider.value = String(v);
        updateDisplay(v);
        onChange(v);
      }
    });
  });
}

function updateDisplay(v: number): void {
  if (speedVal) {
    speedVal.textContent = v.toFixed(2).replace(/0$/, '') + '×';
  }
  speedPills.forEach((pill) => {
    const pillSpeed = parseFloat(pill.dataset.speed || '0');
    if (Math.abs(pillSpeed - v) < 0.04) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });
}

/**
 * Get current speed value.
 */
export function getSpeed(): number {
  return speedSlider ? parseFloat(speedSlider.value) : 1.0;
}

/**
 * Programmatically update speed slider, label, and active pill.
 */
export function setSpeed(v: number): void {
  if (speedSlider && !Number.isNaN(v) && v > 0) {
    speedSlider.value = String(v);
    updateDisplay(v);
  }
}
