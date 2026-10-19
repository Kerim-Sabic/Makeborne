// The UX audit's in-page script, verbatim (audit §3.2, S3). It measures the
// whole document as rendered: horizontal overflow, small targets, unlabeled
// buttons, headings, text below WCAG AA contrast (4.5:1, or 3:1 for large text),
// font sizes, images without alt, :focus-visible rules and the editor toolbar.
// It is kept as a string so the test runs exactly what the audit ran.
export const AUDIT_SCRIPT = String.raw`const out = {url: location.href, overflowX: document.documentElement.scrollWidth - innerWidth};
const small = [];
for (const el of document.querySelectorAll('button, a, input, select, [role=button]')) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24)) small.push({tag: el.tagName, text: (el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,40), w: Math.round(r.width), h: Math.round(r.height)}); }
out.tinyTargets = small.slice(0, 12); out.tinyCount = small.length;
out.unlabeledButtons = [...document.querySelectorAll('button')].filter(b => !(b.getAttribute('aria-label')||b.textContent||'').trim()).map(b=>b.outerHTML.slice(0,100)).slice(0,6);
out.headings = [...document.querySelectorAll('h1,h2,h3')].map(h => h.tagName + ': ' + h.textContent.trim().slice(0,45)).slice(0,20);
const lum = c => { const [r,g,b] = c.match(/\d+(\.\d+)?/g).map(Number).slice(0,3).map(v => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4)}); return 0.2126*r+0.7152*g+0.0722*b; };
const ratio = (a,b) => { const la = lum(a), lb = lum(b); return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05); };
const bg = el => { while (el) { const c = getComputedStyle(el).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; el = el.parentElement; } return 'rgb(255,255,255)'; };
const low = [];
for (const el of document.querySelectorAll('p, span, a, button, label, small, li, h1, h2, h3, dt, dd')) { if (![...el.childNodes].some(n => n.nodeType===3 && n.textContent.trim())) continue; const cs = getComputedStyle(el); if (cs.visibility==='hidden'||cs.display==='none'||parseFloat(cs.opacity)===0) continue; const fg = cs.color; if (/rgba\([^)]*, 0\)/.test(fg)) continue; const r = ratio(fg, bg(el)); const size = parseFloat(cs.fontSize); const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight) >= 700); if (r < (large?3:4.5)) low.push({text: el.textContent.trim().slice(0,36), ratio: +r.toFixed(2), size, fg, bg: bg(el)}); }
out.lowContrast = low.slice(0, 14); out.lowContrastCount = low.length;
out.fontSizes = [...new Set([...document.querySelectorAll('p,span,a,button,label,li')].map(e => getComputedStyle(e).fontSize))].sort((a,b)=>parseFloat(a)-parseFloat(b));
out.imagesNoAlt = [...document.images].filter(i => !i.hasAttribute('alt')).length;
out.focusVisibleRules = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules] } catch { return [] } }).filter(r => r.selectorText && /focus-visible/.test(r.selectorText)).length;
const tabs = document.querySelector('.workbench-toolbar, [aria-label="Project view"]'); out.toolbar = tabs ? {w: Math.round(tabs.getBoundingClientRect().width), sw: tabs.scrollWidth, clipped: tabs.scrollWidth > tabs.clientWidth} : null;
JSON.stringify(out);`;

/**
 * Run the audit in the page's main frame and parse its JSON. The script is
 * wrapped in a block so its top-level consts never collide with an earlier run
 * in the same document; the block's completion value is the JSON string.
 */
export async function runAudit(page) {
  const json = await page.evaluate(`{\n${AUDIT_SCRIPT}\n}`);
  return JSON.parse(json);
}
