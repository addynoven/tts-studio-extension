import { JSDOM } from 'jsdom';
const dom = new JSDOM('<html></html>');
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.DOMParser = dom.window.DOMParser;
global.Element = dom.window.Element;

import fs from 'fs';
const baseJson = fs.readFileSync('dist/mathmaps/base.json', 'utf-8');
const enJson = fs.readFileSync('dist/mathmaps/en.json', 'utf-8');

// MUST set BEFORE import
globalThis.SREfeature = { delay: true };

const mod = await import('speech-rule-engine/lib/sre.js');
const SRE = mod.default || mod;

console.log('SRE version:', SRE.version);
console.log('SRE keys:', Object.keys(SRE).slice(0, 10));

await SRE.setupEngine({
  locale: 'en',
  domain: 'clearspeak',
  custom: (loc) => {
    console.log('Loader called for:', loc);
    const data = { base: baseJson, en: enJson }[loc];
    return data ? Promise.resolve(data) : Promise.reject('no locale');
  }
});

console.log('Waiting for engine ready...');
try {
  await SRE.engineReady();
  console.log('Engine is ready!');
} catch(e) {
  console.log('engineReady error:', e.message);
}

console.log('Setup:', JSON.stringify(SRE.engineSetup(), null, 2));

console.log('\n--- Test toSpeech ---');
try {
  const result = SRE.toSpeech('<mo>=</mo>');
  console.log('Result for = :', JSON.stringify(result));
} catch(e) {
  console.log('Error:', e.message);
}

try {
  const result = SRE.toSpeech('<math><mi>x</mi></math>');
  console.log('Result for x :', JSON.stringify(result));
} catch(e) {
  console.log('Error:', e.message);
}
