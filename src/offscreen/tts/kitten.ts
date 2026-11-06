/**
 * KittenTTS ONNX inference engine.
 */

import { MODEL_PATHS } from '../../shared/constants.js';
import { getExtensionUrl } from '../../shared/extension-url.js';
import { fetchAndCache } from '../cache/indexeddb.js';
import { phonemize } from '../utils/phonemize.js';
import { loadORT, createSession, type OrtInferenceSession } from '../utils/ort-loader.js';

let kittenSession: OrtInferenceSession | null = null;
let kittenTokenizer: { model?: { vocab?: Record<string, number> }; vocab?: Record<string, number> } | null = null;
let kittenVoices: Record<string, number[][]> | null = null;

const KITTEN_SAMPLE_RATE = 24000;

export async function loadKitten(onProgress?: ((pct: number) => void) | null, useGPU = false): Promise<void> {
  if (kittenSession) return;

  const base = getExtensionUrl('');
  const [modelBlob, tokenizerBlob, voicesBlob] = await Promise.all([
    fetchAndCache(base + MODEL_PATHS.kitten.onnx, 'kitten-onnx', onProgress),
    fetchAndCache(base + MODEL_PATHS.kitten.tokenizer!, 'kitten-tokenizer', null),
    fetchAndCache(base + MODEL_PATHS.kitten.voices!, 'kitten-voices', null)
  ]);

  const modelArr = new Uint8Array(await modelBlob.arrayBuffer());
  kittenTokenizer = JSON.parse(await tokenizerBlob.text());
  kittenVoices = JSON.parse(await voicesBlob.text());

  kittenSession = await createSession(modelArr, useGPU);
}

export interface TTSResult {
  audio: Float32Array;
  sampleRate: number;
  playbackRate: number;
  wordTimings?: Array<{
    word: string;
    charIndex: number;
    charLength: number;
    startTime: number;
    endTime: number;
  }>;
}

export async function generateKitten(text: string, voice = 'Bella', speed = 1.0): Promise<TTSResult> {
  if (!kittenSession) {
    await loadKitten();
  }
  const ort = await loadORT();
  const vocab = kittenTokenizer?.model?.vocab ?? kittenTokenizer?.vocab ?? {};
  const rawPhonemes = await phonemize(text, 'en-us');

  // Wrap with $ boundary tokens (ID 0)
  const tokens = [0, ...rawPhonemes.split('').map(p => vocab[p] ?? 0), 0];
  if (tokens.length <= 2) throw new Error('Tokenization failed — empty phoneme sequence');

  const voiceEmbedding = (kittenVoices && kittenVoices[voice]) ?? (kittenVoices && Object.values(kittenVoices)[0]);
  if (!voiceEmbedding || !voiceEmbedding[0]) throw new Error(`Voice "${voice}" not found`);

  const speakerEmbedding = new Float32Array(voiceEmbedding[0]);
  const inputIds = new BigInt64Array(tokens.map(id => BigInt(id)));

  const tInput = new ort.Tensor('int64', inputIds, [1, inputIds.length]);
  const tStyle = new ort.Tensor('float32', speakerEmbedding, [1, speakerEmbedding.length]);
  const tSpeed = new ort.Tensor('float32', new Float32Array([speed]), [1]);

  let result: Record<string, { data: Float32Array | BigInt64Array | number[]; dispose?: () => void }> | null = null;
  try {
    result = await kittenSession!.run({
      'input_ids': tInput,
      'style': tStyle,
      'speed': tSpeed
    });

    const rawAudio = result.waveform?.data ?? result[Object.keys(result)[0]]?.data;
    if (!rawAudio) throw new Error('No audio output from KittenTTS model');

    const audio = rawAudio instanceof Float32Array ? new Float32Array(rawAudio) : new Float32Array(rawAudio as number[]);
    return {
      audio,
      sampleRate: KITTEN_SAMPLE_RATE,
      playbackRate: speed
    };
  } finally {
    try { (tInput as { dispose?: () => void }).dispose?.(); } catch {}
    try { (tStyle as { dispose?: () => void }).dispose?.(); } catch {}
    try { (tSpeed as { dispose?: () => void }).dispose?.(); } catch {}
    if (result) {
      for (const val of Object.values(result)) {
        try { val?.dispose?.(); } catch {}
      }
    }
  }
}
