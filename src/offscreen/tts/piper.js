/**
 * Piper ONNX inference engine.
 */

import { MODEL_PATHS } from '../../shared/constants.js';
import { fetchAndCache } from '../cache/indexeddb.js';
import { phonemize } from '../utils/phonemize.js';
import { loadORT, createSession } from '../utils/ort-loader.js';

let piperSession = null;
let piperConfig = null;

export async function loadPiper(onProgress, useGPU = false) {
  if (piperSession) return;

  const base = chrome.runtime.getURL('');
  const [modelBlob, configBlob] = await Promise.all([
    fetchAndCache(base + MODEL_PATHS.piper.onnx, 'piper-onnx', onProgress),
    fetchAndCache(base + MODEL_PATHS.piper.config, 'piper-config', null)
  ]);

  piperConfig = JSON.parse(await configBlob.text());
  const arr = new Uint8Array(await modelBlob.arrayBuffer());

  piperSession = await createSession(arr, useGPU);

  await new Promise(r => setTimeout(r, 100));
}

export async function generatePiper(text, speakerId = 'p335', speed = 1.0) {
  const ort = await loadORT();
  const voice = piperConfig.espeak?.voice || 'en-us';
  const rawPhonemes = await phonemize(text, voice);

  const phonemeIds = piperTextToIds(rawPhonemes, piperConfig);
  const sampleRate = piperConfig.audio?.sample_rate ?? 22050;
  const speakerIdNum = piperConfig.speaker_id_map?.[speakerId] ?? 0;

  const lengthScale = 1.0 / speed;
  const inputIds = new ort.Tensor('int64', BigInt64Array.from(phonemeIds.map(BigInt)), [1, phonemeIds.length]);
  const inputLens = new ort.Tensor('int64', BigInt64Array.from([BigInt(phonemeIds.length)]), [1]);
  const scales = new ort.Tensor('float32', new Float32Array([0.667, lengthScale, 0.8]), [3]);
  const sidTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(speakerIdNum)]), [1]);

  const result = await piperSession.run({
    input: inputIds,
    input_lengths: inputLens,
    scales,
    sid: sidTensor
  });

  const audio = result.output?.data ?? result[Object.keys(result)[0]]?.data;
  return { audio: new Float32Array(audio), sampleRate };
}

function piperTextToIds(phonemeText, config) {
  const pad = config.phoneme_id_map?.['<pad>']?.[0] ?? 0;
  const bos = config.phoneme_id_map?.['^']?.[0] ?? 1;
  const eos = config.phoneme_id_map?.['$']?.[0] ?? 2;

  const ids = [bos, pad];
  for (const ch of phonemeText.normalize('NFD')) {
    const mapped = config.phoneme_id_map?.[ch];
    if (mapped) {
      ids.push(...mapped);
      ids.push(pad);
    }
  }
  ids.push(eos);
  return ids;
}
