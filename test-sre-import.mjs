import { JSDOM } from 'jsdom';
const dom = new JSDOM('<html></html>');
global.window = dom.window;
global.document = dom.window.document;

const mod = await import('speech-rule-engine/lib/sre.js');
console.log('Module keys:', Object.keys(mod));
console.log('Has default:', !!mod.default);
console.log('typeof default:', typeof mod.default);
if (mod.default) {
  console.log('default keys:', Object.keys(mod.default).slice(0, 10));
}
