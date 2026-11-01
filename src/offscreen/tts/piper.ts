/**
 * Piper ONNX inference engine.
 */

import { MODEL_PATHS } from '../../shared/constants.js';
import { getExtensionUrl } from '../../shared/extension-url.js';
import { fetchAndCache } from '../cache/indexeddb.js';
import { phonemize } from '../utils/phonemize.js';
import { loadORT, createSession, type OrtInferenceSession } from '../utils/ort-loader.js';
import type { TTSResult } from './kitten.js';

interface PiperConfig {
  audio?: { sample_rate?: number };
  espeak?: { voice?: string };
  speaker_id_map?: Record<string, number>;
  phoneme_id_map?: Record<string, number[]>;
}

let piperSession: OrtInferenceSession | null = null;
let piperConfig: PiperConfig | null = null;

export async function loadPiper(onProgress?: ((pct: number) => void) | null, useGPU = false): Promise<void> {
  if (piperSession && piperConfig) return;

  const base = getExtensionUrl('');
  const [modelBlob, configBlob] = await Promise.all([
    fetchAndCache(base + MODEL_PATHS.piper.onnx, 'piper-onnx', onProgress),
    fetchAndCache(base + MODEL_PATHS.piper.config!, 'piper-config', null)
  ]);

  piperConfig = JSON.parse(await configBlob.text()) as PiperConfig;
  const arr = new Uint8Array(await modelBlob.arrayBuffer());

  piperSession = await createSession(arr, useGPU);
}

export async function generatePiper(text: string, speakerId = '3922', speed = 1.0): Promise<TTSResult> {
  if (!piperSession || !piperConfig) {
    await loadPiper();
  }
  const ort = await loadORT();
  const voice = piperConfig?.espeak?.voice || 'en-us';
  const rawPhonemes = await phonemize(text, voice);

  const phonemeIds = piperTextToIds(rawPhonemes, piperConfig!);
  const sampleRate = piperConfig?.audio?.sample_rate ?? 22050;
  const speakerIdNum = piperConfig?.speaker_id_map?.[speakerId] ?? 0;

  const lengthScale = 1.0 / speed;
  const inputIds = new ort.Tensor('int64', BigInt64Array.from(phonemeIds.map(BigInt)), [1, phonemeIds.length]);
  const inputLens = new ort.Tensor('int64', BigInt64Array.from([BigInt(phonemeIds.length)]), [1]);
  const scales = new ort.Tensor('float32', new Float32Array([0.667, lengthScale, 0.8]), [3]);
  const sidTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(speakerIdNum)]), [1]);

  const result = await piperSession!.run({
    input: inputIds,
    input_lengths: inputLens,
    scales,
    sid: sidTensor
  });

  const rawAudio = result.output?.data ?? result[Object.keys(result)[0]]?.data;
  if (!rawAudio) throw new Error('No audio output from Piper model');

  const audio = rawAudio instanceof Float32Array ? rawAudio : new Float32Array(rawAudio as number[]);
  return {
    audio,
    sampleRate,
    playbackRate: 1.0
  };
}

function piperTextToIds(phonemeText: string, config: PiperConfig): number[] {
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
