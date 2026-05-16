import { JSDOM } from 'jsdom';
const dom = new JSDOM('<html></html>');
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.DOMParser = dom.window.DOMParser;
global.Element = dom.window.Element;

import fs from 'fs';
import path from 'path';

const mathmapsDir = path.resolve('dist/mathmaps');
const baseJson = fs.readFileSync(path.join(mathmapsDir, 'base.json'), 'utf-8');
const enJson = fs.readFileSync(path.join(mathmapsDir, 'en.json'), 'utf-8');

// Mock fetch to serve local files when SRE requests them
const originalFetch = global.fetch;
global.fetch = async (url) => {
  const urlStr = url.toString();
  if (urlStr.endsWith('base.json')) return { ok: true, text: () => Promise.resolve(baseJson) };
  if (urlStr.endsWith('en.json')) return { ok: true, text: () => Promise.resolve(enJson) };
  return originalFetch(url);
};

globalThis.SREfeature = { delay: true };

const mod = await import('speech-rule-engine/lib/sre.js');
const SRE = mod.default || mod;

console.log('Before setup - engineSetup:', SRE.engineSetup().mode);

await SRE.setupEngine({
  locale: 'en',
  domain: 'clearspeak',
  json: 'file://' + mathmapsDir + '/'
});

console.log('After setup - engineSetup:', SRE.engineSetup().mode, SRE.engineSetup().json);

console.log('Waiting for engine ready...');
await SRE.engineReady();

console.log('Engine ready!');

console.log('\n--- Test toSpeech ---');
const r1 = SRE.toSpeech('<mo>=</mo>');
console.log('Result for = :', JSON.stringify(r1));

const r2 = SRE.toSpeech('<math><mi>x</mi></math>');
console.log('Result for x :', JSON.stringify(r2));

const r3 = SRE.toSpeech('<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>');
console.log('Result for 1/2 :', JSON.stringify(r3));
