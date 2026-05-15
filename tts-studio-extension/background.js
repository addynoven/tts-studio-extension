// background.js — MV3 service worker
// Manages the offscreen document and routes messages between popup ↔ offscreen ↔ content

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen/offscreen.html');

async function ensureOffscreen() {
  const exists = await chrome.offscreen.hasDocument();
  if (!exists) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      // AUDIO_PLAYBACK covers Web Audio API usage
      // DOM_PARSER covers the WASM/ONNX initialization
      reasons: [
        chrome.offscreen.Reason.AUDIO_PLAYBACK,
        chrome.offscreen.Reason.DOM_PARSER
      ],
      justification:
        'ONNX Runtime Web requires a DOM context for WASM; Web Audio API is needed for TTS playback.'
    });
  }
}

// ── Context menu ────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'tts-read-selection',
    title: '🎙️ Read with TTS Studio',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'tts-read-selection' || !info.selectionText) return;

  await ensureOffscreen();
  const { model = 'kokoro', voice, speed = 1.0 } =
    await chrome.storage.local.get(['model', 'voice', 'speed']);

  // Determine default voice per model if none saved
  const defaultVoice = voice || defaultVoiceForModel(model);

  chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'TTS_GENERATE',
    text: info.selectionText.trim(),
    model,
    voice: defaultVoice,
    speed: Number(speed)
  });
});

// ── Message routing ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Popup asks us to create offscreen doc before it sends messages directly
  if (message.type === 'ENSURE_OFFSCREEN') {
    ensureOffscreen()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // keep channel open for async response
  }

  // Popup → offscreen (generate / stop)
  if (message.target === 'offscreen') {
    ensureOffscreen().then(() => {
      chrome.runtime.sendMessage(message).catch(() => {});
    });
    return false;
  }

  // Offscreen → popup (status updates, errors, progress)
  if (message.target === 'popup') {
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup may be closed — that's fine
    });
    return false;
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function defaultVoiceForModel(model) {
  const defaults = {
    kitten: 'Bella',
    kokoro: 'af_heart',

    piper: '3922' // libritts_r speaker id
  };
  return defaults[model] || 'Bella';
}
