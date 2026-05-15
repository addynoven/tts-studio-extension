/**
 * Kokoro ONNX inference engine.
 */

import { MODEL_PATHS } from '../../shared/constants.js';
import { fetchAndCache } from '../cache/indexeddb.js';
import { phonemize, postProcessKokoro } from '../utils/phonemize.js';

const LIB_BASE = chrome.runtime.getURL('assets/lib/');
let ort = null;
let kokoroSession = null;
let kokoroTokenizer = null;
let kokoroVoiceEmbeds = {};

async function loadORT() {
  if (ort) return ort;
  const mod = await import(LIB_BASE + 'ort.min.mjs');
  ort = mod;
  ort.env.wasm.wasmPaths = LIB_BASE;
  ort.env.wasm.numThreads = 1;
  return ort;
}

export async function loadKokoro(onProgress) {
  if (kokoroSession) return;

  await loadORT();

  const base = chrome.runtime.getURL('');
  const modelBlob = await fetchAndCache(base + MODEL_PATHS.kokoro.onnx, 'kokoro-onnx', onProgress);
  const tokenizerBlob = await fetchAndCache(base + MODEL_PATHS.kokoro.tokenizer, 'kokoro-tokenizer', null);

  const modelArr = new Uint8Array(await modelBlob.arrayBuffer());
  kokoroTokenizer = JSON.parse(await tokenizerBlob.text());

  kokoroSession = await ort.InferenceSession.create(modelArr, {
    executionProviders: [{ name: 'wasm', simd: true }]
  });

  await new Promise(r => setTimeout(r, 100));
}

async function loadKokoroVoice(voice) {
  if (kokoroVoiceEmbeds[voice]) return;
  const voiceUrl = chrome.runtime.getURL(MODEL_PATHS.kokoro.voicesDir + voice + '.bin');
  try {
    const res = await fetch(voiceUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    kokoroVoiceEmbeds[voice] = new Float32Array(ab);
  } catch (e) {
    console.error('[Kokoro] Failed to load voice', voice, e);
    throw new Error(`Voice "${voice}" failed to load: ${e.message}`);
  }
}

export async function generateKokoro(text, voice = 'af_heart', speed = 1.0) {
  const language = voice.startsWith('a') ? 'a' : 'b';
  const rawPhonemes = await phonemize(text, language === 'a' ? 'en-us' : 'en');
  const phonemes = postProcessKokoro(rawPhonemes);

  const vocab = kokoroTokenizer.model?.vocab || {};
  const tokens = [0, ...phonemes.split('').map(ch => vocab[ch] ?? 0), 0];

  await loadKokoroVoice(voice);
  const voiceData = kokoroVoiceEmbeds[voice];

  const numTokens = Math.min(Math.max(tokens.length - 2, 0), 509);
  const STYLE_DIM = 256;
  const offset = numTokens * STYLE_DIM;
  const speakerEmbedding = voiceData.slice(offset, offset + STYLE_DIM);

  const inputIds = new BigInt64Array(tokens.map(id => BigInt(id)));

  const inputs = {
    'input_ids': new ort.Tensor('int64', inputIds, [1, inputIds.length]),
    'style': new ort.Tensor('float32', speakerEmbedding, [1, speakerEmbedding.length]),
    'speed': new ort.Tensor('float32', new Float32Array([1.0 / speed]), [1])
  };

  const results = await kokoroSession.run(inputs);
  const audioData = results.waveform?.data || results.output?.data;

  if (!audioData) throw new Error('No audio output from Kokoro model');

  return { audio: new Float32Array(audioData), sampleRate: 24000 };
}
