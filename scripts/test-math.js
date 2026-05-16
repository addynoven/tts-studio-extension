import fs from 'fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync('dump/html/Rayleigh_quotient_iteration.html', 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;

// Find a math element
const mathElement = doc.querySelector('.mwe-math-element');

console.log("RAW textContent:", mathElement.textContent.trim());

// Remove annotations and fallback images
mathElement.querySelectorAll('annotation, .mwe-math-fallback-image-inline, img').forEach(e => e.remove());

console.log("CLEANED textContent:", mathElement.textContent.trim());
