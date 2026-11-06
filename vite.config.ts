import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  copyFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
  renameSync,
  rmSync,
  readFileSync,
  writeFileSync
} from 'fs';
import { build as esbuild } from 'esbuild';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Recursively copy a directory.
 */
function copyDir(src: string, dest: string) {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = resolve(src, entry);
    const destPath = resolve(dest, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Move files from dist/src/X/ to dist/X/ and remove dist/src/.
 * Vite preserves the input path, so src/popup/index.html becomes dist/src/popup/index.html.
 */
function flattenDist() {
  const distSrc = resolve(__dirname, 'dist/src');
  const dist = resolve(__dirname, 'dist');

  if (existsSync(distSrc)) {
    for (const entry of readdirSync(distSrc)) {
      const srcPath = resolve(distSrc, entry);
      const destPath = resolve(dist, entry);
      if (existsSync(destPath)) {
        // Merge: copy files from src/X into existing dist/X
        if (statSync(srcPath).isDirectory()) {
          copyDir(srcPath, destPath);
        }
      } else {
        renameSync(srcPath, destPath);
      }
    }
    // Remove dist/src directory
    try { rmSync(distSrc, { recursive: true, force: true }); } catch {}

    // Fix relative paths in HTML files (Vite generates paths based on src/ location)
    fixHtmlPaths(dist);
  }
}

/**
 * Fix relative paths in HTML files after flattening.
 * Replaces ../../X with ./X for files in dist subdirectories.
 */
function fixHtmlPaths(dir: string) {
  const htmlFiles = findHtmlFiles(dir);
  for (const file of htmlFiles) {
    let content = readFileSync(file, 'utf-8');
    // Replace ../../popup/ with ./, ../../shared/ with ../shared/, etc.
    content = content.replace(/\.\.\/\.\.\/([\w-]+)\//g, (match: string, folderName: string) => {
      const fileDir = file.split('/').slice(-2)[0];
      if (folderName === fileDir) {
        return './';
      }
      return '../' + folderName + '/';
    });
    writeFileSync(file, content);
  }
}

function findHtmlFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      results.push(...findHtmlFiles(path));
    } else if (entry.endsWith('.html')) {
      results.push(path);
    }
  }
  return results;
}

/**
 * Copy static assets from the legacy extension into dist/assets/.
 */
function copyLegacyAssets() {
  const legacy = resolve(__dirname, 'tts-studio-extension');
  const distAssets = resolve(__dirname, 'dist/assets');

  if (existsSync(resolve(legacy, 'icons'))) {
    copyDir(resolve(legacy, 'icons'), resolve(distAssets, 'icons'));
  }
}

/**
 * Copy manifest.json to dist/.
 */
function copyManifest() {
  const src = resolve(__dirname, 'src/manifest.json');
  const dest = resolve(__dirname, 'dist/manifest.json');
  if (existsSync(src)) {
    copyFileSync(src, dest);
  }
}

/**
 * Copy SRE locale files (mathmaps) to dist/ so the content script can fetch them.
 */
function copyMathmaps() {
  const src = resolve(__dirname, 'node_modules/speech-rule-engine/lib/mathmaps');
  const dest = resolve(__dirname, 'dist/mathmaps');
  if (existsSync(src)) {
    copyDir(src, dest);
  }
}

/**
 * Copy ONNX runtime and Transformers.js wasm/mjs files to dist/transformers/
 * so the extension loads them locally without violating Manifest V3 CSP.
 */
function copyTransformersAssets() {
  const dest = resolve(__dirname, 'dist/transformers');
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });

  const searchDirs = [
    resolve(__dirname, 'node_modules/@huggingface/transformers/dist'),
    resolve(__dirname, 'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist'),
    resolve(__dirname, 'node_modules/onnxruntime-web/dist')
  ];

  for (const src of searchDirs) {
    if (!existsSync(src)) continue;
    for (const file of readdirSync(src)) {
      if (file.endsWith('.wasm') || file.endsWith('.mjs') || (file.endsWith('.js') && file.startsWith('ort-'))) {
        const destFile = resolve(dest, file);
        if (!existsSync(destFile)) {
          if (file === 'ort-wasm-simd-threaded.jsep.mjs') {
            let content = readFileSync(resolve(src, file), 'utf-8');
            content = content.replace(
              'var ta=ra,x=sa;',
              'var ta=ra,x=(...args)=>{if(args.some(a=>typeof a==="string"&&a.includes("VerifyEachNodeIsAssignedToAnEp")))return;sa(...args);};'
            );
            writeFileSync(destFile, content);
          } else {
            copyFileSync(resolve(src, file), destFile);
          }
        }
      }
    }
  }
}

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        offscreen: resolve(__dirname, 'src/offscreen/index.html'),
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        'tts-worker': resolve(__dirname, 'src/offscreen/tts/tts-worker.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background.js';
          if (chunk.name === 'content') return 'content.js';
          return '[name]/[name].js';
        },
        chunkFileNames: 'shared/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name || '';
          if (info.endsWith('.css')) {
            const dir = assetInfo.originalFileNames?.[0]?.split('/').slice(-2)[0] || 'assets';
            return `${dir}/[name][extname]`;
          }
          return 'assets/[name][extname]';
        },
      },
    },
  },
  plugins: [
    {
      name: 'chrome-extension-build',
      async closeBundle() {
        flattenDist();
        copyManifest();
        copyMathmaps();
        copyLegacyAssets();
        copyTransformersAssets();
        await bundleContentScriptIIFE();
        console.log('✓ Chrome extension built to dist/');
      },
    },
  ],
});

/**
 * Re-bundle the content script as a self-contained IIFE.
 *
 * The content script is injected both by the manifest (as module) and
 * programmatically by the background/popup. Chrome's programmatic injection
 * via `chrome.scripting.executeScript({ files })` sometimes injects as a
 * classic script even when the manifest declares `type: "module"`, causing
 * "Cannot use import statement outside a module" syntax errors.
 *
 * Building it as an IIFE eliminates all import/export statements, so it
 * works reliably regardless of how Chrome injects it.
 */
async function bundleContentScriptIIFE(): Promise<void> {
  const entry = resolve(__dirname, 'src/content/index.ts');
  const outFile = resolve(__dirname, 'dist/content.js');

  try {
    await esbuild({
      entryPoints: [entry],
      bundle: true,
      outfile: outFile,
      format: 'iife',
      platform: 'browser',
      target: 'chrome100',
      // Ensure all shared code is inlined; no external chunks
      splitting: false,
      // Minify only in production builds (Vite sets NODE_ENV)
      minify: process.env.NODE_ENV === 'production',
      // Preserve console.logs for debugging unless explicitly stripped
      drop: [],
    });
    console.log('✓ Content script re-bundled as IIFE');
  } catch (e) {
    console.error('✗ Content script IIFE build failed:', e);
    throw e;
  }
}
