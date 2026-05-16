import { JSDOM } from 'jsdom';

// First set up the page DOM so JSDOM's XHR can load local files
const html = fs.readFileSync('dump/html/Rayleigh_quotient_iteration.html', 'utf-8');
const pageDom = new JSDOM(html, { url: 'https://en.wikipedia.org/wiki/Rayleigh_quotient_iteration' });

// Set globals from page DOM FIRST (includes native XHR)
global.window = pageDom.window;
global.document = pageDom.window.document;
global.Node = pageDom.window.Node;
global.DOMParser = pageDom.window.DOMParser;
global.Element = pageDom.window.Element;
global.XMLHttpRequest = pageDom.window.XMLHttpRequest;

import fs from 'fs';

global.chrome = { runtime: { getURL: (p) => 'chrome-extension://test/' + p } };

const { initMathSpeech } = await import('./src/content/sanitizer/math-speech.js');
await initMathSpeech();

const { sanitizeForTTS } = await import('./src/content/sanitizer/smart-cleaner.js');

const paragraphs = document.querySelectorAll('p');
console.log('=== All sanitized paragraphs ===\n');
paragraphs.forEach((p, i) => {
  const text = sanitizeForTTS(p.innerHTML).trim();
  if (!text) return;
  const letters = (text.match(/[a-zA-Z]/g) || []).length;
  const lastChar = text.replace(/\s+$/, '').slice(-1);
  const passes = text.length >= 25 && letters >= text.length * 0.3 && /[.!?]/.test(lastChar);
  console.log(`[P${i}] length=${text.length} letters=${letters} last="${lastChar}" ${passes ? 'PASS' : 'FAIL'}`);
  console.log(text.slice(0, 250));
  console.log('');
});
