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

// Mock XMLHttpRequest
const originalXHR = global.XMLHttpRequest;
global.XMLHttpRequest = class MockXHR {
  constructor() {
    this.url = '';
    this.readyState = 0;
  }
  open(method, url) {
    this.url = url;
    console.log('XHR OPEN:', url);
  }
  send() {
    const url = this.url;
    setTimeout(() => {
      this.readyState = 4;
      if (url.endsWith('base.json')) {
        this.status = 200;
        this.responseText = baseJson;
      } else if (url.endsWith('en.json')) {
        this.status = 200;
        this.responseText = enJson;
      } else {
        this.status = 404;
        this.responseText = '';
      }
      if (this.onreadystatechange) this.onreadystatechange();
    }, 10);
  }
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
console.log('Engine ready!');

console.log('toSpeech = :', JSON.stringify(SRE.toSpeech('<mo>=</mo>')));
console.log('toSpeech x :', JSON.stringify(SRE.toSpeech('<math><mi>x</mi></math>')));
