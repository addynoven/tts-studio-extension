// popup.js — UI logic

// ── Voice definitions ─────────────────────────────────────────────────────

const VOICES = {
  kitten: [
    { id: 'Bella',  label: 'Bella  (F)' },
    { id: 'Jasper', label: 'Jasper (M)' },
    { id: 'Luna',   label: 'Luna   (F)' },
    { id: 'Bruno',  label: 'Bruno  (M)' },
    { id: 'Rosie',  label: 'Rosie  (F)' },
    { id: 'Hugo',   label: 'Hugo   (M)' },
    { id: 'Kiki',   label: 'Kiki   (F)' },
    { id: 'Leo',    label: 'Leo    (M)' }
  ],
  kokoro: [
    { id: 'af',       label: 'af — Default Female' },
    { id: 'af_alloy', label: 'Alloy — AF' },
    { id: 'af_aoede', label: 'Aoede — AF' },
    { id: 'af_bella', label: 'Bella — AF (bright)' },
    { id: 'af_heart', label: 'Heart — AF (warm)' },
    { id: 'af_jessica', label: 'Jessica — AF' },
    { id: 'af_kore',  label: 'Kore — AF' },
    { id: 'af_nicole', label: 'Nicole — AF (smooth)' },
    { id: 'af_nova',  label: 'Nova — AF' },
    { id: 'af_river', label: 'River — AF' },
    { id: 'af_sarah', label: 'Sarah — AF (clear)' },
    { id: 'af_sky',   label: 'Sky — AF (airy)' },
    { id: 'am_adam',  label: 'Adam — AM (deep)' },
    { id: 'am_echo',  label: 'Echo — AM' },
    { id: 'am_eric',  label: 'Eric — AM' },
    { id: 'am_fenrir', label: 'Fenrir — AM' },
    { id: 'am_liam',  label: 'Liam — AM' },
    { id: 'am_michael', label: 'Michael — AM (rich)' },
    { id: 'am_onyx',  label: 'Onyx — AM' },
    { id: 'am_puck',  label: 'Puck — AM' },
    { id: 'am_santa', label: 'Santa — AM' }
  ],
  piper: [] // Loaded dynamically from Piper config — see loadPiperVoices()
};

// ── State ─────────────────────────────────────────────────────────────────

let currentModel = 'kokoro';
let isGenerating = false;

// ── DOM refs ──────────────────────────────────────────────────────────────

const body        = document.body;
const tabs        = document.querySelectorAll('.model-tab');
const voiceSelect = document.getElementById('voiceSelect');
const speedSlider = document.getElementById('speedSlider');
const speedVal    = document.getElementById('speedVal');
const gpuToggle   = document.getElementById('gpuToggle');
const textInput   = document.getElementById('textInput');
const charCount   = document.getElementById('charCount');
const btnGenerate = document.getElementById('btnGenerate');
const btnStop     = document.getElementById('btnStop');
const btnSelected = document.getElementById('btnSelected');
const btnCopyStatus = document.getElementById('btnCopyStatus');
const statusDot   = document.getElementById('statusDot');
const statusText  = document.getElementById('statusText');
const progressWrap= document.getElementById('progressWrap');
const progressFill= document.getElementById('progressFill');
const waveform    = document.getElementById('waveform');
const logoAccent  = document.getElementById('logoAccent');

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  // Restore saved settings
  const saved = await chrome.storage.local.get(['model', 'voice', 'speed', 'gpu', 'text']);
  if (saved.model) switchModel(saved.model, false);
  if (saved.voice) voiceSelect.value = saved.voice;
  if (saved.speed) {
    speedSlider.value = saved.speed;
    updateSpeedDisplay(saved.speed);
  }
  if (saved.gpu) gpuToggle.classList.toggle('on', saved.gpu);
  if (saved.text) textInput.value = saved.text;
  charCount.textContent = textInput.value.length;

  // Make sure offscreen doc is ready
  await chrome.runtime.sendMessage({ type: 'ENSURE_OFFSCREEN' });
}

// ── Dynamic Piper voice loading ───────────────────────────────────────────

let piperVoicesLoaded = false;

async function loadPiperVoices() {
  if (piperVoicesLoaded) return;
  try {
    const configUrl = chrome.runtime.getURL('models/piper/en_US-libritts_r-medium.onnx.json');
    const res = await fetch(configUrl);
    const config = await res.json();
    const speakers = config.speaker_id_map || {};

    VOICES.piper = Object.entries(speakers)
      .sort(([, a], [, b]) => a - b)
      .map(([id, num]) => ({ id, label: `Speaker ${id}` }));

    piperVoicesLoaded = true;
  } catch (e) {
    console.error('Failed to load Piper voices:', e);
    VOICES.piper = [{ id: '3922', label: 'Speaker 3922 (fallback)' }];
  }
}

// ── Model switching ───────────────────────────────────────────────────────

async function switchModel(model, save = true) {
  currentModel = model;
  body.dataset.model = model;

  // Update tabs
  tabs.forEach(t => t.classList.toggle('active', t.dataset.model === model));

  // Update logo text
  const labels = { kitten: 'Kitten', kokoro: 'Studio', piper: 'Piper' };
  logoAccent.textContent = labels[model] || 'Studio';

  // Load Piper voices on-demand
  if (model === 'piper') await loadPiperVoices();

  // Repopulate voices
  const voices = VOICES[model] || [];
  voiceSelect.innerHTML = voices
    .map(v => `<option value="${v.id}">${v.label}</option>`)
    .join('');

  // Restore saved voice if it matches this model
  chrome.storage.local.get('voice').then(({ voice }) => {
    if (voice && voices.some(v => v.id === voice)) voiceSelect.value = voice;
  });

  if (save) chrome.storage.local.set({ model });
}

tabs.forEach(tab => {
  tab.addEventListener('click', () => switchModel(tab.dataset.model));
});

// ── Controls ──────────────────────────────────────────────────────────────

speedSlider.addEventListener('input', () => {
  const v = parseFloat(speedSlider.value);
  updateSpeedDisplay(v);
  chrome.storage.local.set({ speed: v });
});

function updateSpeedDisplay(v) {
  speedVal.textContent = v.toFixed(2).replace(/0$/, '') + '×';
}

voiceSelect.addEventListener('change', () => {
  chrome.storage.local.set({ voice: voiceSelect.value });
});

gpuToggle.addEventListener('click', () => {
  gpuToggle.classList.toggle('on');
  chrome.storage.local.set({ gpu: gpuToggle.classList.contains('on') });
});

textInput.addEventListener('input', () => {
  charCount.textContent = textInput.value.length;
  chrome.storage.local.set({ text: textInput.value });
});

// ── Get selected text from active tab ────────────────────────────────────

btnSelected.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    const { text } = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTION' });
    if (text) {
      textInput.value = text;
      charCount.textContent = text.length;
      chrome.storage.local.set({ text });
    } else {
      setStatus('idle', 'No text selected on page');
    }
  } catch {
    setStatus('error', 'Cannot read page — try reloading it');
  }
});

// ── Generate ──────────────────────────────────────────────────────────────

btnGenerate.addEventListener('click', generate);

async function generate() {
  const text = textInput.value.trim();
  if (!text) { setStatus('idle', 'Enter some text first'); return; }
  if (isGenerating) return;

  isGenerating = true;
  btnGenerate.disabled = true;
  btnStop.disabled = false;
  setStatus('loading', 'Loading model…');

  chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'TTS_GENERATE',
    text,
    model: currentModel,
    voice: voiceSelect.value,
    speed: parseFloat(speedSlider.value),
    useGPU: gpuToggle.classList.contains('on')
  });
}

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'TTS_STOP' });
  resetButtons();
  setStatus('idle', 'Stopped');
});

function resetButtons() {
  isGenerating = false;
  btnGenerate.disabled = false;
  btnStop.disabled = true;
  waveform.classList.remove('playing');
}

// ── Status updates from offscreen ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'popup') return;

  switch (message.type) {
    case 'STATUS_MODEL_LOADING':
      setStatus('loading', `Downloading ${message.model} model… first time only`);
      break;
    case 'STATUS_GENERATING':
      setStatus('generating', 'Synthesizing speech…');
      break;
    case 'STATUS_PLAYING':
      setStatus('playing', 'Playing…');
      waveform.classList.add('playing');
      break;
    case 'STATUS_DONE':
      resetButtons();
      setStatus('ready', 'Done ✓');
      setTimeout(() => setStatus('idle', 'Ready'), 3000);
      break;
    case 'STATUS_ERROR':
      resetButtons();
      setStatus('error', `Error: ${message.error}`);
      break;
    case 'STATUS_PROGRESS':
      updateProgress(message.percent);
      break;
  }
});

// ── Status helpers ────────────────────────────────────────────────────────

function setStatus(state, text) {
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
}

function updateProgress(percent) {
  progressFill.classList.remove('indeterminate');
  progressFill.style.width = percent + '%';
}

// ── Copy status ───────────────────────────────────────────────────────────

btnCopyStatus.addEventListener('click', async () => {
  const text = statusText.textContent;
  try {
    await navigator.clipboard.writeText(text);
    const original = btnCopyStatus.textContent;
    btnCopyStatus.textContent = '✓';
    setTimeout(() => btnCopyStatus.textContent = original, 1200);
  } catch {
    // Fallback for contexts where clipboard API is unavailable
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    const original = btnCopyStatus.textContent;
    btnCopyStatus.textContent = '✓';
    setTimeout(() => btnCopyStatus.textContent = original, 1200);
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────

init().catch(console.error);
