/**
 * Shared ONNX Runtime Web loader.
 * Both TTS engines import from here to avoid loading ORT twice.
 */

import { getExtensionUrl } from '../../shared/extension-url.js';

const LIB_BASE = getExtensionUrl('assets/lib/');

export interface OrtInferenceSession {
  run(feeds: Record<string, unknown>, options?: unknown): Promise<Record<string, { data: Float32Array | BigInt64Array | number[] }>>;
}

export interface OrtModule {
  env: {
    wasm: {
      wasmPaths: string;
      numThreads: number;
    };
  };
  InferenceSession: {
    create(model: Uint8Array, options?: unknown): Promise<OrtInferenceSession>;
  };
  Tensor: new (type: string, data: unknown, dims: number[]) => unknown;
}

let ortInstance: OrtModule | null = null;

/**
 * Load ONNX Runtime Web (cached after first call).
 */
export async function loadORT(): Promise<OrtModule> {
  if (ortInstance) return ortInstance;
  const mod = await import(/* @vite-ignore */ LIB_BASE + 'ort.min.mjs');
  ortInstance = (mod.default || mod) as OrtModule;
  ortInstance.env.wasm.wasmPaths = LIB_BASE;
  ortInstance.env.wasm.numThreads = 1;
  return ortInstance;
}

/**
 * Create an ONNX inference session with the given model buffer.
 * @param modelArr - Model binary
 * @param useGPU - if true, try WebGPU first with WASM fallback
 */
export async function createSession(modelArr: Uint8Array, useGPU = false): Promise<OrtInferenceSession> {
  const ort = await loadORT();

  if (useGPU) {
    try {
      const session = await ort.InferenceSession.create(modelArr, {
        executionProviders: ['webgpu', { name: 'wasm', simd: true }]
      });
      return session;
    } catch (e) {
      console.warn('[ORT] WebGPU failed, falling back to WASM:', (e as Error).message);
    }
  }

  return ort.InferenceSession.create(modelArr, {
    executionProviders: [{ name: 'wasm', simd: true }]
  });
}
