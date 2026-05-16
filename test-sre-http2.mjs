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

let fetchCount = 0;
const originalFetch = global.fetch;
global.fetch = async (url) => {
  fetchCount++;
  const urlStr = url.toString();
  console.log('FETCH #' + fetchCount + ':', urlStr.slice(0, 100));
  if (urlStr.endsWith('base.json')) return { ok: true, text: () => Promise.resolve(baseJson) };
  if (urlStr.endsWith('en.json')) return { ok: true, text: () => Promise.resolve(enJson) };
  return originalFetch(url);
};

globalThis.SREfeature = { delay: true };

const mod = await import('speech-rule-engine/lib/sre.js');
const SRE = mod.default || mod;

await SRE.setupEngine({
  locale: 'en',
  domain: 'clearspeak',
  json: 'file://' + mathmapsDir + '/'
});

await SRE.engineReady();
console.log('Total fetches:', fetchCount);

console.log('toSpeech test:');
console.log(JSON.stringify(SRE.toSpeech('<mo>=</mo>')));
