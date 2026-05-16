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

globalThis.SREfeature = { delay: true };

const mod = await import('speech-rule-engine/lib/sre.js');
const SRE = mod.default || mod;

// Peek at engine internals
const { Engine } = await import('speech-rule-engine/js/common/engine.js');
const engine = Engine.getInstance();

console.log('Before setup - customLoader:', !!engine.customLoader);
console.log('Before setup - mode:', engine.mode);

await SRE.setupEngine({
  locale: 'en',
  domain: 'clearspeak',
  custom: (loc) => {
    console.log('>>> Loader called for:', loc);
    const data = { base: baseJson, en: enJson }[loc];
    return data ? Promise.resolve(data) : Promise.reject('no locale');
  }
});

console.log('After setup - customLoader:', !!engine.customLoader);
console.log('After setup - mode:', engine.mode);
console.log('After setup - delay:', engine.options.delay);

console.log('Waiting for engine ready...');
await SRE.engineReady();

console.log('\n--- Test toSpeech ---');
const result = SRE.toSpeech('<mo>=</mo>');
console.log('Result for = :', JSON.stringify(result));
