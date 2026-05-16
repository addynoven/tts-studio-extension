import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const htmlPath = path.resolve('dump/html/Rayleigh_quotient_iteration.html');
const textPath = path.resolve('dump/text/Rayleigh_quotient_iteration.txt');

const html = fs.readFileSync(htmlPath, 'utf-8');
const dom = new JSDOM(html, { url: 'https://en.wikipedia.org/wiki/Rayleigh_quotient_iteration' });

global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.DOMParser = dom.window.DOMParser;
global.Element = dom.window.Element;
global.XMLHttpRequest = dom.window.XMLHttpRequest;

// Mock chrome.runtime.getURL so SRE can load mathmaps from local files
const mathmapsDir = path.resolve('dist/mathmaps');
global.chrome = {
  runtime: {
    getURL: (p) => 'file://' + path.resolve('dist', p)
  }
};

// Pre-import SRE locales so fetch works with file:// URLs
const baseJson = fs.readFileSync(path.join(mathmapsDir, 'base.json'), 'utf-8');
const enJson = fs.readFileSync(path.join(mathmapsDir, 'en.json'), 'utf-8');

// Override fetch to serve local files
const originalFetch = global.fetch;
global.fetch = async (url) => {
  const urlStr = url.toString();
  if (urlStr.includes('mathmaps/base.json')) {
    return { ok: true, text: () => Promise.resolve(baseJson) };
  }
  if (urlStr.includes('mathmaps/en.json')) {
    return { ok: true, text: () => Promise.resolve(enJson) };
  }
  return originalFetch(url);
};

// Now import and run
const { initMathSpeech } = await import('./src/content/sanitizer/math-speech.js');
const { extractMappedArticle } = await import('./src/content/extractor/dom-mapper.js');

console.log('Initializing SRE...');
await initMathSpeech();
console.log('SRE ready! Running extraction...');

const result = extractMappedArticle();

let debugOutput = `TITLE: ${result.title}\n`;
debugOutput += `TOTAL CHARS: ${result.fullText.length}\n`;
debugOutput += `TOTAL BLOCKS: ${result.blocks.length}\n`;
debugOutput += `========================================================================\n\n`;
debugOutput += `--- FULL COMBINED TEXT ---\n\n`;
debugOutput += result.fullText;
debugOutput += `\n\n========================================================================\n\n`;
debugOutput += `--- INDIVIDUAL BLOCKS [${result.blocks.length}] ---\n\n`;
result.blocks.forEach((block, index) => {
  const tag = block.el && block.el.tagName ? block.el.tagName : 'UNKNOWN';
  debugOutput += `[Block ${index + 1}] <${tag}>\n`;
  debugOutput += `${block.ttsText}\n\n`;
});

fs.writeFileSync(textPath, debugOutput);
console.log(`Saved to: ${textPath}`);
console.log(`Blocks: ${result.blocks.length}, Chars: ${result.fullText.length}`);
