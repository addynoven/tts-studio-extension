/**
 * Speed slider component.
 */

const speedSlider = document.getElementById('speedSlider') as HTMLInputElement;
const speedVal = document.getElementById('speedVal') as HTMLSpanElement;

/**
 * Initialize speed control.
 */
export function initSpeedControl(initialValue: number | null, onChange: (speed: number) => void): void {
  if (initialValue != null) {
    speedSlider.value = String(initialValue);
    updateDisplay(initialValue);
  }

  speedSlider.addEventListener('input', () => {
    const v = parseFloat(speedSlider.value);
    updateDisplay(v);
    onChange(v);
  });
}

function updateDisplay(v: number): void {
  speedVal.textContent = v.toFixed(2).replace(/0$/, '') + '×';
}

/**
 * Get current speed value.
 */
export function getSpeed(): number {
  return parseFloat(speedSlider.value);
}
