/**
 * KittenTTS ONNX inference engine.
 */

import { MODEL_PATHS, LIB_PATHS } from '../../shared/constants.js';
import { fetchAndCache } from '../cache/indexeddb.js';
import { phonemize } from '../utils/phonemize.js';

const LIB_BASE = chrome.runtime.getURL('assets/lib/');
let ort = null;
let kittenSession = null;
let kittenTokenizer = null;
let kittenVoices = null;

async function loadORT() {
  if (ort) return ort;
  const mod = await import(LIB_BASE + 'ort.min.mjs');
  ort = mod;
  ort.env.wasm.wasmPaths = LIB_BASE;
  ort.env.wasm.numThreads = 1;
  return ort;
}

export async function loadKitten(onProgress) {
  if (kittenSession) return;

  await loadORT();

  const base = chrome.runtime.getURL('');
  const [modelBlob, tokenizerBlob, voicesBlob] = await Promise.all([
    fetchAndCache(base + MODEL_PATHS.kitten.onnx, 'kitten-onnx', onProgress),
    fetchAndCache(base + MODEL_PATHS.kitten.tokenizer, 'kitten-tokenizer', null),
    fetchAndCache(base + MODEL_PATHS.kitten.voices, 'kitten-voices', null)
  ]);

  const modelArr = new Uint8Array(await modelBlob.arrayBuffer());
  kittenTokenizer = JSON.parse(await tokenizerBlob.text());
  kittenVoices = JSON.parse(await voicesBlob.text());

  kittenSession = await ort.InferenceSession.create(modelArr, {
    executionProviders: [{ name: 'wasm', simd: true }]
  });
}

export async function generateKitten(text, voice = 'Bella', speed = 1.0) {
  const vocab = kittenTokenizer.model?.vocab ?? kittenTokenizer.vocab ?? {};
  const rawPhonemes = await phonemize(text, 'en-us');

  // Wrap with $ boundary tokens (ID 0)
  const tokens = [0, ...rawPhonemes.split('').map(p => vocab[p] ?? 0), 0];
  if (tokens.length <= 2) throw new Error('Tokenization failed — empty phoneme sequence');

  const voiceEmbedding = kittenVoices[voice] ?? Object.values(kittenVoices)[0];
  if (!voiceEmbedding) throw new Error(`Voice "${voice}" not found`);

  const speakerEmbedding = new Float32Array(voiceEmbedding[0]);
  const inputIds = new BigInt64Array(tokens.map(id => BigInt(id)));

  const result = await kittenSession.run({
    'input_ids': new ort.Tensor('int64', inputIds, [1, inputIds.length]),
    'style': new ort.Tensor('float32', speakerEmbedding, [1, speakerEmbedding.length]),
    'speed': new ort.Tensor('float32', new Float32Array([speed]), [1])
  });

  const audio = result.waveform?.data ?? result[Object.keys(result)[0]]?.data;
  if (!audio) throw new Error('No audio output from KittenTTS model');

  // Post-process speed adjustment (resampling)
  if (speed !== 1.0 && audio.length > 0) {
    const newLength = Math.floor(audio.length / speed);
    const resampled = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIndex = Math.floor(i * speed);
      resampled[i] = audio[Math.min(srcIndex, audio.length - 1)];
    }
    return resampled;
  }

  return audio;
}
