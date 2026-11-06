#!/usr/bin/env node

/**
 * Release Packager for TTS Studio Chrome Extension.
 * Bundles dist/ into a clean, store-ready ZIP archive for Chrome Web Store / GitHub releases.
 */

import { readFileSync, existsSync, statSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const distDir = resolve(rootDir, 'dist');
const manifestPath = resolve(distDir, 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error('❌ dist/manifest.json not found! Run "npm run build" first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const version = manifest.version || '1.0.0';
const zipName = `tts-studio-v${version}.zip`;
const zipPath = resolve(rootDir, zipName);

console.log(`📦 Packaging TTS Studio v${version}...`);

if (existsSync(zipPath)) {
  rmSync(zipPath);
}

try {
  // Zip the contents of dist/ directly so manifest.json is at the root of the archive
  execSync(`cd "${distDir}" && zip -r -9 "${zipPath}" . -x "*.DS_Store"`, { stdio: 'pipe' });

  const stats = statSync(zipPath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

  console.log(`✅ Successfully generated release archive:`);
  console.log(`   📂 File: ${zipName}`);
  console.log(`   📏 Size: ${sizeMb} MB`);
  console.log(`   🎯 Ready for Chrome Web Store or GitHub Release!`);
} catch (err) {
  console.error('❌ Failed to package zip archive:', err);
  process.exit(1);
}
