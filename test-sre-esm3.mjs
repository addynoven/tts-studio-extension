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

let xhrCount = 0;
global.XMLHttpRequest = class MockXHR {
  constructor() { this.url = ''; }
  open(method, url) { this.url = url; xhrCount++; console.log(`XHR #${xhrCount}:`, url); }
  send() {
    setTimeout(() => {
      this.readyState = 4;
      if (this.url.endsWith('base.json')) { this.status = 200; this.responseText = baseJson; }
      else if (this.url.endsWith('en.json')) { this.status = 200; this.responseText = enJson; }
      else { this.status = 404; }
      if (this.onreadystatechange) this.onreadystatechange();
    }, 10);
  }
};

globalThis.SREfeature = { delay: true };

// Patch retrieveMaps BEFORE importing anything
const moduleCache = new Map();
const originalLoad = await import('module').then(m => m.createRequire(import.meta.url));

const SRE = await import('speech-rule-engine/js/index.js');

// Let's trace by calling setupEngine and engineReady step by step
console.log('Step 1: setupEngine with json');
await SRE.setupEngine({
  locale: 'en',
  domain: 'clearspeak',
  json: 'file://' + mathmapsDir + '/'
});
console.log('XHR after step 1:', xhrCount);

console.log('Step 2: engineReady');
await SRE.engineReady();
console.log('XHR after step 2:', xhrCount);

console.log('Step 3: toSpeech');
console.log('Result:', JSON.stringify(SRE.toSpeech('<mo>=</mo>')));
console.log('XHR after step 3:', xhrCount);
