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

global.chrome = {
  runtime: {
    getURL: (p) => 'file://' + p
  }
};

const originalFetch = global.fetch;
global.fetch = async (url) => {
  const urlStr = url.toString();
  if (urlStr.includes('mathmaps/base.json')) return { ok: true, text: () => Promise.resolve(baseJson) };
  if (urlStr.includes('mathmaps/en.json')) return { ok: true, text: () => Promise.resolve(enJson) };
  return originalFetch(url);
};

const { initMathSpeech } = await import('./src/content/sanitizer/math-speech.js');
await initMathSpeech();

const { mathToSpeech } = await import('./src/content/sanitizer/math-speech.js');

// Test simple MathML
const simpleMath = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>μ</mi><mn>0</mn></math>';
console.log('Simple:', mathToSpeech(simpleMath));

// Test fraction
const fracMath = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mn>1</mn><mn>2</mn></mfrac></math>';
console.log('Fraction:', mathToSpeech(fracMath));

// Read actual math from HTML
const html = fs.readFileSync('dump/html/Rayleigh_quotient_iteration.html', 'utf-8');
const dom2 = new JSDOM(html);
const mathEls = dom2.window.document.querySelectorAll('math');
console.log('Found math elements:', mathEls.length);
for (let i = 0; i < Math.min(3, mathEls.length); i++) {
  const el = mathEls[i];
  console.log(`\n--- Math ${i} ---`);
  console.log('OuterHTML:', el.outerHTML.slice(0, 200));
  console.log('SRE result:', mathToSpeech(el.outerHTML));
}
