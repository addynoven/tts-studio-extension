/**
 * KittenTTS ONNX inference engine.
 */

import { MODEL_PATHS } from '../../shared/constants.js';
import { fetchAndCache } from '../cache/indexeddb.js';
import { phonemize } from '../utils/phonemize.js';
import { loadORT, createSession } from '../utils/ort-loader.js';

let kittenSession = null;
let kittenTokenizer = null;
let kittenVoices = null;

// Serialize inference — ONNX WASM session.run() is not thread-safe
const kittenQueue = [];
let kittenRunning = false;

async function runKittenQueue() {
  if (kittenRunning) return;
  kittenRunning = true;
  while (kittenQueue.length > 0) {
    const { fn, resolve, reject } = kittenQueue.shift();
    try {
      resolve(await fn());
    } catch (e) {
      reject(e);
    }
  }
  kittenRunning = false;
}

function enqueueKitten(fn) {
  return new Promise((resolve, reject) => {
    kittenQueue.push({ fn, resolve, reject });
    runKittenQueue();
  });
}

export async function loadKitten(onProgress, useGPU = false) {
  if (kittenSession) return;

  const base = chrome.runtime.getURL('');
  const [modelBlob, tokenizerBlob, voicesBlob] = await Promise.all([
    fetchAndCache(base + MODEL_PATHS.kitten.onnx, 'kitten-onnx', onProgress),
    fetchAndCache(base + MODEL_PATHS.kitten.tokenizer, 'kitten-tokenizer', null),
    fetchAndCache(base + MODEL_PATHS.kitten.voices, 'kitten-voices', null)
  ]);

  const modelArr = new Uint8Array(await modelBlob.arrayBuffer());
  kittenTokenizer = JSON.parse(await tokenizerBlob.text());
  kittenVoices = JSON.parse(await voicesBlob.text());

  kittenSession = await createSession(modelArr, useGPU);
}

export async function generateKitten(text, voice = 'Bella', speed = 1.0) {
  const ort = await loadORT();
  const vocab = kittenTokenizer.model?.vocab ?? kittenTokenizer.vocab ?? {};
  const rawPhonemes = await phonemize(text, 'en-us');

  // Wrap with $ boundary tokens (ID 0)
  const tokens = [0, ...rawPhonemes.split('').map(p => vocab[p] ?? 0), 0];
  if (tokens.length <= 2) throw new Error('Tokenization failed — empty phoneme sequence');

  const voiceEmbedding = kittenVoices[voice] ?? Object.values(kittenVoices)[0];
  if (!voiceEmbedding) throw new Error(`Voice "${voice}" not found`);

  const speakerEmbedding = new Float32Array(voiceEmbedding[0]);
  const inputIds = new BigInt64Array(tokens.map(id => BigInt(id)));

  // Serialize ONNX inference to avoid corrupting shared WASM state
  const result = await enqueueKitten(async () => {
    return await kittenSession.run({
      'input_ids': new ort.Tensor('int64', inputIds, [1, inputIds.length]),
      'style': new ort.Tensor('float32', speakerEmbedding, [1, speakerEmbedding.length]),
      'speed': new ort.Tensor('float32', new Float32Array([speed]), [1])
    });
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
