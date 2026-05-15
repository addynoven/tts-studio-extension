/**
 * Shared ONNX Runtime Web loader.
 * Both TTS engines import from here to avoid loading ORT twice.
 */

import { getExtensionUrl } from '../../shared/extension-url.js';
const LIB_BASE = getExtensionUrl('assets/lib/');
let ort = null;

/**
 * Load ONNX Runtime Web (cached after first call).
 * @returns {Promise<object>} The ort module
 */
export async function loadORT() {
  if (ort) return ort;
  const mod = await import(LIB_BASE + 'ort.min.mjs');
  ort = mod;
  ort.env.wasm.wasmPaths = LIB_BASE;
  ort.env.wasm.numThreads = 1;
  return ort;
}

/**
 * Create an ONNX inference session with the given model buffer.
 * @param {Uint8Array} modelArr
 * @param {boolean} useGPU — if true, try WebGPU first with WASM fallback
 * @returns {Promise<InferenceSession>}
 */
export async function createSession(modelArr, useGPU = false) {
  const ort = await loadORT();

  if (useGPU) {
    try {
      const session = await ort.InferenceSession.create(modelArr, {
        executionProviders: ['webgpu', { name: 'wasm', simd: true }]
      });
      return session;
    } catch (e) {
      console.warn('[ORT] WebGPU failed, falling back to WASM:', e.message);
    }
  }

  return ort.InferenceSession.create(modelArr, {
    executionProviders: [{ name: 'wasm', simd: true }]
  });
}
