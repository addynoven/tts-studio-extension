import { JSDOM } from 'jsdom';
const dom = new JSDOM('<html></html>');
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.DOMParser = dom.window.DOMParser;
global.Element = dom.window.Element;
global.XMLHttpRequest = dom.window.XMLHttpRequest;

import fs from 'fs';
const mathmapsDir = 'dist/mathmaps';
const baseJson = fs.readFileSync(mathmapsDir + '/base.json', 'utf-8');
const enJson = fs.readFileSync(mathmapsDir + '/en.json', 'utf-8');

const originalXHR = global.XMLHttpRequest;
global.XMLHttpRequest = class MockXHR {
  constructor() { this.url = ''; }
  open(method, url) { this.url = url; }
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

globalThis.SREfeature = {
  json: 'file://' + process.cwd() + '/' + mathmapsDir + '/',
  locale: 'en',
  domain: 'clearspeak'
};

const SRE = await import('speech-rule-engine/lib/sre.js');
const sre = SRE.default || SRE;
await sre.engineReady();

// Read the actual MathML from the HTML
const html = fs.readFileSync('dump/html/Rayleigh_quotient_iteration.html', 'utf-8');
const dom2 = new JSDOM(html);
const mathEls = dom2.window.document.querySelectorAll('math');

console.log('=== SRE verbalizations for complex formulas ===\n');
for (let i = 0; i < mathEls.length; i++) {
  const el = mathEls[i];
  const alttext = el.getAttribute('alttext') || '';
  const speech = sre.toSpeech(el.outerHTML);
  console.log(`--- Formula ${i + 1} ---`);
  console.log('LaTeX:', alttext.slice(0, 100));
  console.log('SRE:', speech);
  console.log('Length:', speech.length, 'chars');
  console.log('');
}
