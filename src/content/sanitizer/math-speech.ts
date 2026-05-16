/**
 * Math verbalization for TTS.
 *
 * Uses Speech Rule Engine (SRE) for MathML → spoken text.
 * Falls back to a lightweight LaTeX verbalizer for raw LaTeX strings.
 *
 * SRE is loaded on-demand via dynamic import so the content script
 * startup path stays fast. Locale JSON files are fetched from the
 * extension package (not inlined) to keep the JS bundle size down.
 */

let SRE: import('speech-rule-engine/lib/sre.js').SREInstance | null = null;
let sreReady = false;

/**
 * Initialise SRE. Safe to call multiple times; no-ops after first success.
 * Catches failures silently so extraction never breaks because of math.
 */
export async function initMathSpeech(): Promise<void> {
  if (sreReady) return;

  try {
    // Tell SRE where to load locale JSON files from.
    // MUST be set BEFORE the dynamic import so the auto-setup picks it up.
    (globalThis as any).SREfeature = {
      json:
        typeof chrome !== 'undefined' && chrome.runtime?.getURL
          ? chrome.runtime.getURL('mathmaps/')
          : '',
      locale: 'en',
      domain: 'clearspeak'
    };

    const mod = await import('speech-rule-engine/lib/sre.js');
    // UMD bundle shape differs between bundler (Vite → .default) and Node ESM (direct)
    SRE = (mod.default || mod) as import('speech-rule-engine/lib/sre.js').SREInstance;

    // Wait for SRE to finish loading locale files
    await SRE.engineReady();

    sreReady = true;
  } catch (e) {
    // Silently fall back to latex verbalizer for all math.
    console.warn('[TTS] SRE init failed, using LaTeX fallback:', e);
  }
}

/**
 * Convert a math element or LaTeX string to spoken text.
 *
 * @param source - A `<math>` element, a `.mwe-math-element` wrapper, or a raw LaTeX string
 * @returns Spoken representation suitable for TTS
 */
export function mathToSpeech(source: string | Element): string {
  // ── Fast path: SRE for MathML ────────────────────────────────────────────
  if (sreReady && SRE) {
    const mathml = extractMathML(source);
    if (mathml) {
      try {
        const spoken = SRE.toSpeech(mathml);
        // Cap formula length: long verbalizations destroy paragraph structure
        // and get dropped by the fragment filter. Better to use [formula].
        if (spoken && spoken.length <= 100) return spoken;
        return '[formula]';
      } catch {
        // SRE choked on this formula — fall through to verbalizer
      }
    }
  }

  // ── Fallback: lightweight LaTeX verbalizer ───────────────────────────────
  const latex = typeof source === 'string' ? source : extractLatexFromElement(source);
  const spoken = latexToSpoken(latex);
  return spoken || '[formula]';
}

/** Pull MathML string from an element or return the string if it already is MathML. */
function extractMathML(source: string | Element): string | null {
  const ElementCtor = globalThis.Element;
  if (ElementCtor && source instanceof ElementCtor) {
    if (source.tagName.toLowerCase() === 'math') {
      return source.outerHTML;
    }
    const mathEl = source.querySelector('math');
    if (mathEl) return mathEl.outerHTML;
    return null;
  }
  if (typeof source === 'string' && source.trim().startsWith('<math')) {
    return source;
  }
  return null;
}

/** Extract raw LaTeX source from a Wikipedia-style math element. */
function extractLatexFromElement(el: Element): string {
  const img = el.querySelector('img[alt]');
  if (img) return img.getAttribute('alt') || '';

  const ann = el.querySelector(
    'annotation[encoding="application/x-tex"], annotation'
  );
  if (ann) return ann.textContent || '';

  if (el.hasAttribute('alttext')) {
    return el.getAttribute('alttext') || '';
  }

  return '';
}

/**
 * Lightweight LaTeX → spoken text converter.
 * Handles common Wikipedia math patterns without pulling in MathJax.
 */
export function latexToSpoken(latex: string): string {
  if (!latex) return '';

  let s = latex;

  // Strip displaystyle wrapper
  s = s.replace(/\{\\displaystyle\s+/g, '');
  s = s.replace(/\\displaystyle\s+/g, '');

  // Remove outer braces that wrap the whole formula
  s = s.replace(/^\{\s*/, '').replace(/\s*\}$/, '');

  // Replace common LaTeX commands with spoken equivalents
  const replacements: Array<[RegExp, string]> = [
    [/\\mu/g, 'mu'],
    [/\\lambda/g, 'lambda'],
    [/\\varphi/g, 'phi'],
    [/\\pi/g, 'pi'],
    [/\\alpha/g, 'alpha'],
    [/\\beta/g, 'beta'],
    [/\\gamma/g, 'gamma'],
    [/\\delta/g, 'delta'],
    [/\\sigma/g, 'sigma'],
    [/\\omega/g, 'omega'],
    [/\\theta/g, 'theta'],
    [/\\rho/g, 'rho'],
    [/\\tau/g, 'tau'],
    [/\\eta/g, 'eta'],
    [/\\psi/g, 'psi'],
    [/\\chi/g, 'chi'],
    [/\\xi/g, 'xi'],
    [/\\zeta/g, 'zeta'],
    [/\\nu/g, 'nu'],
    [/\\kappa/g, 'kappa'],
    [/\\epsilon/g, 'epsilon'],
    [/\\sqrt/g, 'square root of'],
    [/\\frac/g, ''],
    [/\\left/g, ''],
    [/\\right/g, ''],
    [/\\begin\{matrix\}/g, ''],
    [/\\end\{matrix\}/g, ''],
    [/\\begin\{bmatrix\}/g, ''],
    [/\\end\{bmatrix\}/g, ''],
    [/\\cdots/g, ''],
    [/\\dots/g, ''],
    [/\\approx/g, 'approximately'],
    [/\\pm/g, 'plus or minus'],
    [/\\times/g, 'times'],
    [/\\div/g, 'divided by'],
    [/\\leq/g, 'less than or equal to'],
    [/\\geq/g, 'greater than or equal to'],
    [/\\neq/g, 'not equal to'],
    [/\\in/g, 'in'],
    [/\\forall/g, 'for all'],
    [/\\exists/g, 'there exists'],
    [/\\infty/g, 'infinity'],
    [/\\inf/g, 'infinity'],
    [/\\sum/g, 'sum'],
    [/\\prod/g, 'product'],
    [/\\int/g, 'integral'],
    [/\\partial/g, 'partial'],
    [/\\nabla/g, 'nabla'],
    [/\\cdot/g, ''],
    [/\\ast/g, ''],
    [/\\to/g, 'to'],
    [/\\rightarrow/g, 'to'],
    [/\\mapsto/g, 'maps to'],
    [/\\\|/g, ''],
    [/\\,/g, ' '],
    [/\\;/g, ' '],
    [/\\!/g, ''],
    [/\\ /g, ' '],
    [/\\_/g, ''],
    [/\\#/g, ''],
    [/\\&/g, ''],
    [/\\%/g, ''],
    [/\\\$/g, ''],
    [/\\textstyle/g, ''],
    [/\\textbf/g, ''],
    [/\\textit/g, ''],
    [/\\emph/g, ''],
  ];

  for (const [regex, repl] of replacements) {
    s = s.replace(regex, repl);
  }

  // Subscripts: b_{0} → b 0,  \mu _{i} → mu i
  s = s.replace(/_\{\s*([^}]*)\}/g, ' $1');
  s = s.replace(/_\s*(\w)/g, ' $1');

  // Superscripts: b^{*} → b star,  x^{2} → x squared
  s = s.replace(/\^\{\s*\*\s*\}/g, ' star');
  s = s.replace(/\^\{\s*T\s*\}/g, ' transpose');
  s = s.replace(/\^\{\s*([^}]*)\}/g, ' to the $1');
  s = s.replace(/\^\s*(\w)/g, ' to the $1');

  // Remove remaining backslashes before known commands we missed
  s = s.replace(/\\([a-zA-Z]+)/g, '$1');
  s = s.replace(/\\([^a-zA-Z])/g, '$1');

  // Clean up matrix syntax leftovers
  s = s.replace(/&/g, ' ');
  s = s.replace(/\\\n/g, ' ');

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();

  // If after all cleanup it's empty or just brackets, return empty
  if (!s || /^[\[\]\(\)\{\}\|]*$/.test(s)) return '';

  return s;
}
