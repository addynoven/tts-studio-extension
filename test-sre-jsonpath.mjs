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

// Set json path BEFORE import
globalThis.SREfeature = { json: 'file://' + mathmapsDir + '/' };

const SRE = await import('speech-rule-engine/lib/sre.js');
const sre = SRE.default || SRE;

console.log('Auto-setup XHRs:', xhrCount);

await sre.engineReady();
console.log('After engineReady XHRs:', xhrCount);

console.log('toSpeech = :', JSON.stringify(sre.toSpeech('<mo>=</mo>')));
console.log('toSpeech x :', JSON.stringify(sre.toSpeech('<math><mi>x</mi></math>')));
