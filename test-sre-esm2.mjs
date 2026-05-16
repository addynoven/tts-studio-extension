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

// Monkey-patch XMLHttpRequest
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

// Import BEFORE monkey-patching MathMap
const SRE = await import('speech-rule-engine/js/index.js');

// Now monkey-patch loadLocale to see if it's called
const MathMap = await import('speech-rule-engine/js/speech_rules/math_map.js');
const originalLoadLocale = MathMap.loadLocale;
MathMap.loadLocale = function(...args) {
  console.log('>>> loadLocale called with:', args);
  return originalLoadLocale.apply(this, args);
};

console.log('Engine mode before setup:', (await import('speech-rule-engine/js/common/engine.js')).Engine.getInstance().mode);

await SRE.setupEngine({
  locale: 'en',
  domain: 'clearspeak',
  json: 'file://' + mathmapsDir + '/'
});

console.log('Engine mode after setup:', (await import('speech-rule-engine/js/common/engine.js')).Engine.getInstance().mode);

await SRE.engineReady();
console.log('Engine ready! Total XHRs:', xhrCount);

console.log('toSpeech = :', JSON.stringify(SRE.toSpeech('<mo>=</mo>')));
