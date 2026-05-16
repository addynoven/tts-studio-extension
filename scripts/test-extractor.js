import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DUMP_DIR = path.resolve(__dirname, '../dump');
const HTML_DUMP_DIR = path.join(DUMP_DIR, 'html');
const TEXT_DUMP_DIR = path.join(DUMP_DIR, 'text');

// Ensure dump directories exist
if (!fs.existsSync(HTML_DUMP_DIR)) fs.mkdirSync(HTML_DUMP_DIR, { recursive: true });
if (!fs.existsSync(TEXT_DUMP_DIR)) fs.mkdirSync(TEXT_DUMP_DIR, { recursive: true });

// Test URL — pass as argument or default to MDN
const TEST_URL = process.argv[2] || 'https://developer.mozilla.org/en-US/docs/Web/JavaScript';

async function runTest() {
  console.log(`Fetching: ${TEST_URL}`);
  
  // 1. Fetch the HTML
  const response = await fetch(TEST_URL);
  const html = await response.text();
  
  const pageName = TEST_URL.split('/').pop() || 'index';
  
  // 2. Save original HTML
  const htmlPath = path.join(HTML_DUMP_DIR, `${pageName}.html`);
  fs.writeFileSync(htmlPath, html);
  console.log(`Saved HTML to: ${htmlPath}`);

  // 3. Set up JSDOM environment
  const dom = new JSDOM(html, { url: TEST_URL });
  
  // Simulate browser globals required by Readability and our extractor
  global.window = dom.window;
  global.document = dom.window.document;
  global.Node = dom.window.Node;
  global.DOMParser = dom.window.DOMParser;
  
  // We need to dynamically import the extractor AFTER setting up globals
  // because the extractor might rely on `document` at the top level.
  const { extractMappedArticle } = await import('../src/content/extractor/dom-mapper.js');
  
  try {
    // 4. Run our custom DOM-mapped extraction
    console.log('Running dom-mapper.js extraction...');
    const result = extractMappedArticle();
    
    // 5. Save the output
    const textPath = path.join(TEXT_DUMP_DIR, `${pageName}.txt`);
    
    // Let's create a nice formatted debug output
    let debugOutput = `URL: ${TEST_URL}\n`;
    debugOutput += `TITLE: ${result.title}\n`;
    debugOutput += `TOTAL CHARS: ${result.fullText.length}\n`;
    debugOutput += `TOTAL BLOCKS: ${result.blocks.length}\n`;
    debugOutput += `========================================================================\n\n`;
    
    debugOutput += `--- FULL COMBINED TEXT ---\n\n`;
    debugOutput += result.fullText;
    debugOutput += `\n\n========================================================================\n\n`;
    
    debugOutput += `--- INDIVIDUAL BLOCKS [${result.blocks.length}] ---\n\n`;
    result.blocks.forEach((block, index) => {
      // For JSDOM, block.el.tagName might be available
      const tag = block.el && block.el.tagName ? block.el.tagName : 'UNKNOWN';
      debugOutput += `[Block ${index + 1}] <${tag}>\n`;
      debugOutput += `${block.ttsText}\n\n`;
    });
    
    fs.writeFileSync(textPath, debugOutput);
    console.log(`Saved extracted text to: ${textPath}`);
    console.log(`Extraction successful! Extracted ${result.blocks.length} blocks.`);
    
  } catch (error) {
    console.error('Extraction failed:', error);
  }
}

runTest();
