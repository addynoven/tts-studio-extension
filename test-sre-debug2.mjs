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

global.chrome = { runtime: { getURL: (p) => 'file://' + p } };

const originalFetch = global.fetch;
global.fetch = async (url) => {
  const urlStr = url.toString();
  if (urlStr.includes('mathmaps/base.json')) return { ok: true, text: () => Promise.resolve(baseJson) };
  if (urlStr.includes('mathmaps/en.json')) return { ok: true, text: () => Promise.resolve(enJson) };
  return originalFetch(url);
};

const mod = await import('speech-rule-engine/lib/sre.js');
const SRE = mod.default || mod;

globalThis.SREfeature = { delay: true };

await SRE.setupEngine({
  locale: 'en',
  domain: 'clearspeak',
  custom: (loc) => {
    console.log('Loading locale:', loc);
    const data = { base: baseJson, en: enJson }[loc];
    return data ? Promise.resolve(data) : Promise.reject('no');
  }
});

console.log('Engine ready?');
await SRE.engineReady();
console.log('Setup:', SRE.engineSetup());

console.log('\nTest 1 - simple equals:');
try { console.log(SRE.toSpeech('<mo>=</mo>')); } catch(e) { console.log('Error:', e.message); }

console.log('\nTest 2 - mu sub 0:');
try { console.log(SRE.toSpeech('<math><mi>μ</mi><mn>0</mn></math>')); } catch(e) { console.log('Error:', e.message); }

console.log('\nTest 3 - fraction:');
try { console.log(SRE.toSpeech('<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>')); } catch(e) { console.log('Error:', e.message); }
