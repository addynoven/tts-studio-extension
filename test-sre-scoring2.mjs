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

const html = fs.readFileSync('dump/html/Rayleigh_quotient_iteration.html', 'utf-8');
const dom2 = new JSDOM(html);
const mathEls = dom2.window.document.querySelectorAll('math');

[60, 80, 100].forEach(threshold => {
  let kept = 0, replaced = 0;
  console.log(`\n=== Threshold: ${threshold} chars ===`);
  for (let i = 0; i < mathEls.length; i++) {
    const speech = sre.toSpeech(mathEls[i].outerHTML);
    if (speech.length <= threshold) {
      kept++;
      console.log(`  KEEP (${speech.length}): ${speech.slice(0, 70)}`);
    } else {
      replaced++;
      console.log(`  DROP (${speech.length}): ${speech.slice(0, 70)}...`);
    }
  }
  console.log(`  Kept: ${kept}, Replaced: ${replaced}`);
});
