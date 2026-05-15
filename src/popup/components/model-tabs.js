/**
 * Model tab switcher component.
 */

import { MODEL_LABELS } from '../../shared/constants.js';

const tabs = document.querySelectorAll('.model-tab');
const logoAccent = document.getElementById('logoAccent');
const body = document.body;

let onSwitchCallback = null;

/**
 * Initialize model tabs.
 * @param {function} onSwitch - (model) => void
 */
export function initModelTabs(onSwitch) {
  onSwitchCallback = onSwitch;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const model = tab.dataset.model;
      setActiveModel(model);
      if (onSwitchCallback) onSwitchCallback(model);
    });
  });
}

/**
 * Set the active model visually.
 * @param {string} model - 'kitten' | 'kokoro' | 'piper'
 */
export function setActiveModel(model) {
  body.dataset.model = model;
  tabs.forEach(t => t.classList.toggle('active', t.dataset.model === model));
  logoAccent.textContent = MODEL_LABELS[model] || 'Studio';
}

/**
 * Get the currently active model.
 * @returns {string}
 */
export function getActiveModel() {
  return body.dataset.model || 'kokoro';
}
