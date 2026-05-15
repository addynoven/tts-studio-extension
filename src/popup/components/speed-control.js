/**
 * Speed slider component.
 */

const speedSlider = document.getElementById('speedSlider');
const speedVal = document.getElementById('speedVal');

/**
 * Initialize speed control.
 * @param {number} [initialValue] - Starting speed
 * @param {function} onChange - (speed) => void
 */
export function initSpeedControl(initialValue, onChange) {
  if (initialValue != null) {
    speedSlider.value = initialValue;
    updateDisplay(initialValue);
  }

  speedSlider.addEventListener('input', () => {
    const v = parseFloat(speedSlider.value);
    updateDisplay(v);
    onChange(v);
  });
}

function updateDisplay(v) {
  speedVal.textContent = v.toFixed(2).replace(/0$/, '') + '×';
}

/**
 * Get current speed value.
 * @returns {number}
 */
export function getSpeed() {
  return parseFloat(speedSlider.value);
}
