/**
 * Model tab switcher component.
 */

import { MODEL_LABELS } from '../../shared/constants.js';

const tabs = document.querySelectorAll('.model-tab');
const logoAccent = document.getElementById('logoAccent');
const body = document.body;

let onSwitchCallback: ((model: string) => void) | null = null;

/**
 * Initialize model tabs.
 */
export function initModelTabs(onSwitch: (model: string) => void): void {
  onSwitchCallback = onSwitch;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const model = (tab as HTMLElement).dataset.model!;
      setActiveModel(model);
      if (onSwitchCallback) onSwitchCallback(model);
    });
  });
}

/**
 * Set the active model visually.
 */
export function setActiveModel(model: string): void {
  body.dataset.model = model;
  tabs.forEach(t => t.classList.toggle('active', (t as HTMLElement).dataset.model === model));
  if (logoAccent) logoAccent.textContent = (MODEL_LABELS as Record<string, string>)[model] || 'Studio';
}

/**
 * Get the currently active model.
 */
export function getActiveModel(): string {
  return body.dataset.model || 'piper';
}
