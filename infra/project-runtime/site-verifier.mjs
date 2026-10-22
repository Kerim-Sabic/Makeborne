/** Deterministic verifier for a generated website, run from retained bytes in the hardened Chromium of
 * isolated-chromium.mjs. Operator/worker code only; never import into request handlers.
 *
 * verifySite() serves {indexHtml, files} at a fixed https test origin with the published site's real headers and
 * CSP (customer-sites/site-policy.js), drives the site with trusted Playwright input (mouse, keyboard) and reads
 * every measurement either in a CDP isolated world (project scripts cannot patch its bindings or globals) or from
 * the Playwright side (request ledger, page errors, URL, screenshots). A check that did not run is `not_checked`
 * with a reason, never `passed`. Time and steps are bounded; when either runs out the remaining checks are
 * reported as not_checked. Evidence (screenshots) goes to a caller-provided directory outside outputs/.
 *
 * Reused logic (adapted to the isolated world, not imported, because those modules run in the page's main world):
 * - horizontal overflow: scripts/eval/lib/instruments/web.mjs evalOverflow() (containing-block aware offenders,
 *   root clipping);
 * - covered text / hit testing: src/lib/builder/contrast-probe.ts coveredText() (elementFromPoint at the centre,
 *   a hit outside the element's own subtree means it is covered);
 * - readiness: publication-renderer.mjs (root has children, eager images decoded, fonts settled, two frames);
 * - the reduced-motion and fixed-bar rules mirror the finish gates in src/lib/builder/quality-gates.ts
 *   ("[data-reveal] hidden state outside no-preference", "fixed bottom bar covers content on phones"), measured on
 *   the rendered page instead of the source;
 * - the enquiry contract mirrors infra/customer-sites/forms.js (see isolated-chromium.mjs enquiryContract). */
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {VERIFIER_ORIGIN, launchIsolatedChromium, openSiteContext, trustedWorld} from './isolated-chromium.mjs';

export const REPORT_SCHEMA = 'makeborne.site-verification/1';
export const DEFAULT_VIEWPORTS = Object.freeze([{width: 360, height: 740}, {width: 390, height: 844}, {width: 820, height: 1180}, {width: 1440, height: 900}]);
export const DEFAULT_LIMITS = Object.freeze({timeMs: 180_000, maxSteps: 3000});
export const UNKNOWN_ROUTE = '/__makeborne_unknown__';
/** Every check this verifier can report, in plan order. */
export const CHECKS = Object.freeze(['version', 'route-load', 'overflow', 'occlusion', 'fixed-bars', 'navigation', 'external-links', 'unknown-route',
  'mobile-menu', 'mobile-menu-escape', 'keyboard-reach', 'focus-visible', 'keyboard-trap', 'primary-action', 'form-empty-submit', 'form-submit', 'reduced-motion']);
export const FICTIONAL = Object.freeze({name: 'Verifier Test', email: 'verifier@example.invalid', phone: '+44 0000 000000', message: 'Automated check'});
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const label = viewport => `${viewport.width}x${viewport.height}`;
const isPhone = viewport => viewport.width < 600;
const isNarrow = viewport => viewport.width < 768;
const TAB_REACH_BOUND = 25, TAB_PRESSES = 40, FOCUS_SAMPLES = 12;
/** Fixed or stuck-sticky elements on a phone: one may cover at most 25 % of the screen, all together at most 35 %. */
export const FIXED_SHARE = Object.freeze({single: 0.25, total: 0.35});

// ---------------------------------------------------------------- identity and budget

const sha256 = value => createHash('sha256').update(value).digest('hex');
/** Digest of the exact bytes verified: the document and every file (path, content type, bytes), path-sorted. */
export function siteDigest(site) {
  const files = [...site.files].map(file => [file.path, file.contentType, sha256(file.body)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return `sha256:${sha256(JSON.stringify({indexHtml: sha256(Buffer.from(site.indexHtml)), files}))}`;
}

export class BudgetExhausted extends Error {
  constructor(kind) { super(kind === 'time' ? 'time budget exhausted' : 'step budget exhausted'); this.kind = kind; this.code = 'BUDGET_EXHAUSTED'; }
}
/** Steps are browser actions (navigations, clicks, key presses, scroll sweeps); time is wall-clock for the whole run. */
export class Budget {
  constructor({timeMs = DEFAULT_LIMITS.timeMs, maxSteps = DEFAULT_LIMITS.maxSteps} = {}, now = Date.now) {
    if (!Number.isInteger(timeMs) || timeMs < 1000 || timeMs > 900_000) throw Error('VERIFY_TIME_LIMIT_INVALID');
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 20_000) throw Error('VERIFY_STEP_LIMIT_INVALID');
    this.now = now; this.deadline = now() + timeMs; this.maxSteps = maxSteps; this.steps = 0; this.timeMs = timeMs;
  }
  exhaustedBy() { return this.now() >= this.deadline ? 'time' : this.steps >= this.maxSteps ? 'steps' : null; }
  step() { const by = this.exhaustedBy(); if (by) throw new BudgetExhausted(by); this.steps++; }
  remainingMs() { return Math.max(0, this.deadline - this.now()); }
}

// ---------------------------------------------------------------- pure classification (offline-tested)

const normalPath = value => (String(value).replace(/\/+$/, '') || '/');
/** Classify one href against the site's declared routes and files. Never fetches anything. */
export function classifyLink(raw, {origin = VERIFIER_ORIGIN, routes = [{path: '/'}], files = []} = {}) {
  const href = String(raw ?? '').trim();
  if (!href) return {kind: 'empty'};
  if (/^(?:tel|mailto|sms):/i.test(href)) return {kind: 'contact', scheme: href.split(':')[0].toLowerCase()};
  if (/^javascript:/i.test(href)) return {kind: 'script'};
  let url;
  try { url = new URL(href, `${origin}/`); } catch { return {kind: 'invalid'}; }
  if (!/^https?:$/.test(url.protocol)) return {kind: 'other', scheme: url.protocol.replace(/:$/, '')};
  if (url.origin !== origin) return {kind: 'external', host: url.host};
  const declared = new Set(routes.map(route => normalPath(route.path)));
  const decode = value => { try { return decodeURIComponent(value); } catch { return value; } };
  if (href.startsWith('#') || url.pathname === '/' || url.pathname === '/index.html') {
    const hash = url.hash;
    if (!hash || hash === '#' || hash === '#/') return {kind: 'route', path: '/', declared: true, anchor: null};
    if (hash.startsWith('#/')) {
      const [route, anchor] = decode(hash.slice(1)).split('#');
      const routePath = normalPath(route.split('?')[0]);
      return {kind: 'route', path: routePath, declared: declared.has(routePath), anchor: anchor || null};
    }
    return {kind: 'anchor', anchor: decode(hash.slice(1)), home: !href.startsWith('#')};
  }
  if (files.includes(url.pathname)) return {kind: 'file', path: url.pathname};
  const routePath = normalPath(url.pathname);
  return {kind: 'path', path: routePath, declared: declared.has(routePath), anchor: url.hash ? decode(url.hash.slice(1)) : null};
}

const HONEST_UNSENT = /\b(?:not (?:been )?sent|nothing (?:was|has been|is) sent|(?:isn.?t|is not|aren.?t|are not) (?:yet )?(?:available|enabled|switched on|connected|set up|turned on)|unavailable|can.?t be sent|cannot be sent|could(?:n.?t| not) (?:be )?sen[dt]|preview|not connected|try again)\b/i;
const CLAIMS_SENT = /\b(?:thank(?:s| you)|sent|received|on its way|we.?ll (?:be in touch|reply|get back|call)|got (?:it|your)|success)\b/i;
/** The form-submit rule. `posts` are the enquiry-sink records of this submission. */
export function decideForm({posts = [], violations = [], message = '', navigatedTo = null, invalidAfterFill = [], mailto = false, origin = VERIFIER_ORIGIN}) {
  if (mailto) return {status: 'not_checked', reason: 'the form submits to a mailto: address (not followed)', observed: 'form action is mailto:'};
  const offsite = violations.filter(item => item.kind === 'off-origin' || item.kind === 'non-get' || item.kind === 'popup');
  if (offsite.length) return {status: 'failed', observed: `the submission tried to reach ${offsite.map(item => item.url).join(', ')} (aborted, nothing left the verifier)`, reason: 'the form posts outside the site\'s own /_mb/enquiries endpoint'};
  if (navigatedTo && new URL(navigatedTo).origin !== origin) return {status: 'failed', observed: `the page navigated to ${navigatedTo}`, reason: 'submitting navigates off the site'};
  if (navigatedTo && new URL(navigatedTo).pathname === '/_mb/enquiries') return {status: 'failed', observed: `a native form post navigated to /_mb/enquiries (sink answered ${posts[0]?.status ?? '?'})`, reason: 'the form posts natively instead of sending JSON with fetch: visitors land on the endpoint\'s JSON reply'};
  if (posts.length > 1) return {status: 'failed', observed: `${posts.length} POSTs reached /_mb/enquiries for one submit`, reason: 'one submit must send exactly one enquiry'};
  if (posts.length === 1) {
    const [post] = posts;
    if (post.status !== 200) return {status: 'failed', observed: `one POST; the enquiry contract answered ${post.status} (${post.response?.error?.message ?? ''})${message ? `; page says "${message}"` : ''}`, reason: 'the payload does not match the hosted enquiry contract (requestId, name, email, message as JSON)'};
    if (!message) return {status: 'failed', observed: 'one POST was accepted but no visible status message appeared', reason: 'after an accepted enquiry the visitor must see a confirmation (role="status")'};
    return {status: 'passed', observed: `one accepted POST; visible status "${message}"`};
  }
  if (invalidAfterFill.length) return {status: 'not_checked', observed: `still invalid after filling fictional values: ${invalidAfterFill.join(', ')}`, reason: 'the form rejected the verifier\'s fictional values, so sending could not be exercised'};
  if (message && HONEST_UNSENT.test(message) && !/\b(?:your|the) (?:enquiry|message|request|form) (?:was|has been) sent\b/i.test(message)) return {status: 'passed', observed: `no POST; the page says honestly "${message}"`};
  if (message && CLAIMS_SENT.test(message)) return {status: 'failed', observed: `no POST reached the endpoint but the page says "${message}"`, reason: 'the form claims success without sending anything'};
  return {status: 'failed', observed: message ? `no POST; page shows "${message}"` : 'no POST and no visible status message', reason: 'submitting a filled form neither sends an enquiry nor tells the visitor that nothing was sent'};
}

/** The primary-action rule, from what the click changed. */
export function decidePrimary({link, effect, baselineMutations = 0, violations = []}) {
  const evidence = [];
  if (violations.length) return {status: 'failed', observed: `the action tried to reach ${violations.map(item => item.url).join(', ')} (aborted)`, reason: 'the primary action leaves the site unexpectedly'};
  if (link?.kind === 'route' && !link.declared) return {status: 'failed', observed: `links to #${link.path}, which is not a declared route`, reason: 'the primary action points at a page that does not exist'};
  if (effect.urlChanged) evidence.push(`URL changed to ${effect.url}`);
  if (Math.abs(effect.dy) > 2) evidence.push(`scrolled ${Math.round(effect.dy)} px`);
  if (effect.newForm) evidence.push('a form became visible');
  if (effect.dialog) evidence.push('a dialog opened');
  if (effect.focusMoved) evidence.push(`focus moved to ${effect.focusMoved}`);
  if (effect.mutations > 0 && baselineMutations === 0) evidence.push(`the page changed (${effect.mutations} DOM mutations)`);
  if (link?.kind === 'anchor' && !effect.anchorTarget && !effect.urlChanged) return {status: 'failed', observed: `links to #${link.anchor} but no element has that id${evidence.length ? `; ${evidence.join('; ')}` : ''}`, reason: 'the primary action points at a missing section'};
  if (!evidence.length) return {status: 'failed', observed: `nothing happened within ${effect.waitedMs} ms: no URL change, scroll, form, dialog, focus move${baselineMutations ? '' : ' or DOM change'}`, reason: baselineMutations ? 'the primary action has no visible effect (the page mutates on its own, so DOM changes were not counted)' : 'the primary action has no visible effect (no handler, no link target)'};
  return {status: 'passed', observed: evidence.join('; ')};
}

// ---------------------------------------------------------------- isolated-world probes
// Each function below is serialised and evaluated in the CDP isolated world. They must be self-contained.

// `__mbv` below is the isolated world's helper object, installed by verifierPrelude() before every probe.
export function verifierPrelude() {
  if (globalThis.__mbv) return;
  const H = globalThis.__mbv = {refs: []};
  H.ref = el => { if (!el) return -1; let index = H.refs.indexOf(el); if (index < 0) { H.refs.push(el); index = H.refs.length - 1; } return index; };
  H.get = index => (index >= 0 ? H.refs[index] ?? null : null);
  H.sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  H.frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  H.text = el => ((el && (el.innerText ?? el.textContent)) || '').replace(/\s+/g, ' ').trim();
  H.rendered = el => { if (!el || !el.isConnected || el.nodeType !== 1) return false; const r = el.getBoundingClientRect(); return r.width >= 1 && r.height >= 1 && getComputedStyle(el).visibility === 'visible'; };
  H.opacity = el => { let value = 1; for (let node = el; node && node.nodeType === 1; node = node.parentElement) value *= Number(getComputedStyle(node).opacity); return value; };
  H.className = el => (typeof el.className === 'string' ? el.className : el.getAttribute('class') || '');
  H.describe = el => {
    if (!el || el.nodeType !== 1) return String(el);
    const cls = H.className(el).trim() ? `.${H.className(el).trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    const text = H.text(el).slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}${text ? ` "${text}"` : ''}`;
  };
  H.name = el => {
    const label = el.getAttribute('aria-label'); if (label && label.trim()) return label.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) { const text = by.split(/\s+/).map(id => H.text(document.getElementById(id))).join(' ').trim(); if (text) return text; }
    const text = H.text(el); if (text) return text;
    if (el.tagName === 'INPUT' && el.value) return el.value;
    const title = el.getAttribute('title'); if (title) return title;
    const image = el.querySelector('img[alt]'); if (image) return image.getAttribute('alt').trim();
    const svgTitle = el.querySelector('svg title'); return svgTitle ? svgTitle.textContent.trim() : '';
  };
  H.rect = el => { const r = el.getBoundingClientRect(); return {left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height)}; };
  H.inView = r => r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  H.center = el => { const r = el.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; };
  /** contrast-probe.ts coveredText(): a hit outside the element's own subtree (and not an ancestor) means it is covered. */
  H.hit = el => {
    const {x, y} = H.center(el);
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return {inside: false, ok: false, x, y};
    const hit = document.elementFromPoint(x, y);
    return {inside: true, x, y, hit, ok: !!hit && (hit === el || el.contains(hit) || hit.contains(el))};
  };
  H.positioned = el => { for (let node = el; node && node.nodeType === 1; node = node.parentElement) { const position = getComputedStyle(node).position; if (position === 'fixed' || position === 'sticky') return {el: node, position}; } return null; };
  H.color = value => {
    if (!value || value === 'transparent') return {a: 0};
    const match = /^rgba?\(([^)]+)\)/.exec(value);
    if (!match) return {a: 1, raw: value};
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return {r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1};
  };
  H.backdrop = el => { for (let node = el.parentElement; node; node = node.parentElement) { const colour = H.color(getComputedStyle(node).backgroundColor); if (colour.a > 0.5) return colour; } return {r: 255, g: 255, b: 255, a: 1}; };
  H.sameColour = (a, b) => !a.raw && !b.raw && Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 12;
  H.isToggle = el => el.hasAttribute('aria-expanded') || el.hasAttribute('aria-controls') || el.tagName === 'SUMMARY';
  /** The primary call(s) to action in the first screen: button-styled links/buttons, hero (main) first. */
  H.primary = limit => {
    const found = [];
    for (const el of document.querySelectorAll('a[href], button, [role="button"], input[type="submit"], input[type="button"]')) {
      if (!H.rendered(el) || H.isToggle(el) || el.closest('summary, form')) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
      const text = H.name(el);
      if (text.length < 2 || text.length > 60 || /^skip\b/i.test(text)) continue;
      const style = getComputedStyle(el), background = H.color(style.backgroundColor);
      let score = 0;
      if (background.a > 0.5 && !H.sameColour(background, H.backdrop(el))) score += 3;
      else if (parseFloat(style.borderTopWidth) >= 1 && style.borderTopStyle !== 'none' && parseFloat(style.paddingLeft) >= 8 && (parseFloat(style.borderTopLeftRadius) > 0 || parseFloat(style.paddingTop) >= 6)) score += 2.5;
      if (/(?:^|[\s_-])(?:btn|button|cta|primary)(?:$|[\s_-])/i.test(H.className(el))) score += 1;
      if (el.closest('main, [role="main"]')) score += 1;
      if (Number.parseInt(style.fontWeight, 10) >= 600) score += 0.5;
      if (el.closest('nav') && score < 3) score -= 2;
      if (score >= 3) found.push({el, score, order: found.length});
    }
    found.sort((a, b) => b.score - a.score || a.order - b.order);
    return found.slice(0, limit).map(({el}) => ({ref: H.ref(el), desc: H.describe(el), text: H.name(el).slice(0, 60), href: el.getAttribute('href'), tag: el.tagName.toLowerCase(), hittable: H.hit(el).ok, rect: H.rect(el)}));
  };
  H.visibleForms = () => [...document.forms].filter(form => [...form.elements].some(field => H.rendered(field) && H.inView(field.getBoundingClientRect()))).length;
  H.focusStyle = el => {
    const pick = (style, keys) => keys.map(key => style.getPropertyValue(key)).join('|');
    const own = ['box-shadow', 'border-top-color', 'border-bottom-color', 'border-bottom-width', 'background-color', 'background-image', 'color', 'text-decoration-line', 'text-decoration-thickness', 'text-underline-offset', 'transform', 'opacity'];
    const pseudo = ['content', 'opacity', 'transform', 'background-color', 'width', 'height', 'border-bottom-color', 'box-shadow'];
    const parent = ['box-shadow', 'background-color', 'border-top-color'];
    // An outline whose style is none paints nothing, whatever its computed width or colour say.
    const outline = style => (style.outlineStyle === 'none' ? 'none' : `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor} ${style.outlineOffset}`);
    const self = getComputedStyle(el), up = el.parentElement ? getComputedStyle(el.parentElement) : null;
    return [outline(self), pick(self, own), pick(getComputedStyle(el, '::before'), pseudo), pick(getComputedStyle(el, '::after'), pseudo), up ? `${outline(up)}|${pick(up, parent)}` : ''].join('#');
  };
  H.notFound = () => /\b(?:page not found|not found|404|couldn.?t find|could not find|doesn.?t exist|does not exist|no such page)\b/i.test(`${document.title} ${H.text(document.body).slice(0, 3000)}`);
}

function probeReady({waitMs}) {
  const H = __mbv;
  return (async () => {
    const end = Date.now() + waitMs;
    const root = () => document.getElementById('root') || document.body;
    while (document.readyState !== 'complete' || !root()?.children.length) {
      if (Date.now() > end) return {rootReady: false, readyState: document.readyState};
      await H.sleep(25);
    }
    for (const image of document.images) if (image.loading === 'lazy') image.loading = 'eager';
    await Promise.race([document.fonts.ready, H.sleep(2000)]);
    await Promise.race([Promise.all([...document.images].map(image => image.decode().catch(() => {}))), H.sleep(Math.max(300, end - Date.now()))]);
    await H.frames(); await H.sleep(150);
    return {rootReady: true, failedFonts: [...document.fonts].filter(face => face.status === 'error').map(face => face.family).slice(0, 5)};
  })();
}

function probeLoad() {
  const H = __mbv;
  const root = document.getElementById('root') || document.body;
  const h1s = [...document.querySelectorAll('h1')].map(el => ({text: H.text(el).slice(0, 120), rendered: H.rendered(el)}));
  const images = [...document.images].map(image => ({src: (image.currentSrc || image.getAttribute('src') || '').slice(0, 200), complete: image.complete, natural: image.naturalWidth, rendered: H.rendered(image)}));
  return {
    rootChildren: root.children.length, title: document.title, textLength: H.text(document.body).length, h1s, notFound: H.notFound(),
    broken: images.filter(image => image.complete && (image.natural === 0 || !image.src)), pending: images.filter(image => !image.complete).length, images: images.length,
    hash: location.hash,
  };
}

/** web.mjs evalOverflow(): document overflow, offenders with no clipping ancestor (containing-block aware), root clipping. */
function probeOverflow() {
  const H = __mbv, doc = document.documentElement, vw = doc.clientWidth;
  const scrollWidth = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0);
  const createsBlock = s => s.position !== 'static' || s.transform !== 'none' || s.filter !== 'none' || /paint|layout|strict|content/.test(s.contain) || /transform/.test(s.willChange);
  const fixedBlock = s => s.transform !== 'none' || s.filter !== 'none' || /paint|layout|strict|content/.test(s.contain);
  const clips = s => ['hidden', 'clip', 'auto', 'scroll'].includes(s.overflowX) || /paint|strict|content/.test(s.contain);
  const offenders = [], offending = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META'].includes(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || !(r.right > vw + 1 || r.left < -1) || r.right <= 0) continue;
    if (!H.rendered(el) || offending.some(item => item.contains(el))) continue;
    let position = getComputedStyle(el).position, escaping = position === 'absolute' || position === 'fixed', clipped = false;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (escaping) { if (!(position === 'fixed' ? fixedBlock(s) : createsBlock(s))) continue; escaping = false; }
      if (clips(s)) { clipped = a !== document.body && a !== doc; if (!clipped) clipped = 'root'; break; }
      if (s.position === 'absolute' || s.position === 'fixed') { escaping = true; position = s.position; }
    }
    if ((escaping && position === 'fixed') || clipped === true) continue;
    offending.push(el);
    offenders.push({clippedByRoot: clipped === 'root', desc: H.describe(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width)});
    if (offenders.length >= 8) break;
  }
  const rootOverflowX = [getComputedStyle(doc).overflowX, document.body ? getComputedStyle(document.body).overflowX : 'visible'];
  return {viewport: vw, scrollWidth, overflowPx: Math.max(0, scrollWidth - vw), rootClips: rootOverflowX.some(value => value === 'hidden' || value === 'clip'), offenders};
}

function probeOcclusion({refs}) {
  const H = __mbv;
  scrollTo({top: 0, left: 0, behavior: 'instant'});
  const h1 = [...document.querySelectorAll('h1')].find(H.rendered) || null;
  const items = [...(h1 ? [{el: h1, role: 'h1'}] : []), ...refs.map(ref => ({el: H.get(ref), role: 'primary action'})).filter(item => item.el)];
  return items.map(({el, role}) => {
    const hit = H.hit(el), base = {role, desc: H.describe(el), rect: H.rect(el)};
    if (!hit.inside) return {...base, inside: false};
    if (hit.ok) return {...base, inside: true, covered: false};
    const by = hit.hit ? H.positioned(hit.hit) : null;
    return {...base, inside: true, covered: true, by: hit.hit ? H.describe(hit.hit) : 'nothing (outside the document)', byPosition: by ? by.position : hit.hit ? getComputedStyle(hit.hit).position : null, byLayer: by ? H.describe(by.el) : null};
  });
}

/** Share of the viewport whose topmost element is fixed or stuck-sticky (a 15 x 25 grid of hit tests). */
function probeFixed() {
  const H = __mbv, cols = 15, rows = 25, counts = new Map();
  const layer = hit => {
    let found = null;
    for (let node = hit; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.position === 'fixed') found = node;
      else if (s.position === 'sticky' && !found) {
        const r = node.getBoundingClientRect(), top = parseFloat(s.top), bottom = parseFloat(s.bottom), parent = node.parentElement?.getBoundingClientRect();
        const stuckTop = !Number.isNaN(top) && Math.abs(r.top - top) < 1.5 && parent && parent.top < r.top - 1;
        const stuckBottom = !Number.isNaN(bottom) && Math.abs(innerHeight - r.bottom - bottom) < 1.5 && parent && parent.bottom > r.bottom + 1;
        if (stuckTop || stuckBottom) found = node;
      }
    }
    return found;
  };
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const hit = document.elementFromPoint((i + 0.5) * innerWidth / cols, (j + 0.5) * innerHeight / rows);
    const element = hit && layer(hit);
    if (element) counts.set(element, (counts.get(element) || 0) + 1);
  }
  const total = cols * rows;
  const layers = [...counts].map(([el, count]) => ({desc: H.describe(el), position: getComputedStyle(el).position, share: count / total, rect: H.rect(el)})).sort((a, b) => b.share - a.share);
  return {scrollY: Math.round(scrollY), layers: layers.slice(0, 6), total: layers.reduce((sum, item) => sum + item.share, 0)};
}

function probeScroll({to}) {
  const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
  const y = to === 'mid' ? Math.round(max * 0.4) : to === 'top' ? 0 : Math.min(max, Number(to));
  scrollTo({top: y, left: 0, behavior: 'instant'});
  return {y: scrollY, max, height: document.documentElement.scrollHeight};
}

function probeLinks() {
  const H = __mbv;
  const ids = [...document.querySelectorAll('[id]')].map(el => el.id).concat([...document.querySelectorAll('a[name]')].map(el => el.getAttribute('name')));
  const links = [...document.querySelectorAll('a[href], area[href]')].map(el => ({ref: H.ref(el), raw: el.getAttribute('href'), text: (H.name(el) || '').slice(0, 60), rendered: H.rendered(el), hittable: H.rendered(el) && H.hit(el).ok, target: el.getAttribute('target')}));
  const h1 = [...document.querySelectorAll('h1')].find(H.rendered);
  return {links, ids: [...new Set(ids)], h1: h1 ? H.text(h1).slice(0, 120) : null};
}

function probeAnchor({anchor}) {
  const H = __mbv;
  const target = document.getElementById(anchor) || document.getElementsByName(anchor)[0] || null;
  const h1 = [...document.querySelectorAll('h1')].find(H.rendered);
  if (!target) return {exists: false, hash: location.hash, h1: h1 ? H.text(h1).slice(0, 120) : null, path: location.pathname};
  const r = target.getBoundingClientRect();
  return {exists: true, inView: r.top > -8 && r.top < innerHeight * 0.75, top: Math.round(r.top), hash: location.hash, h1: h1 ? H.text(h1).slice(0, 120) : null, path: location.pathname};
}

function probeClickTarget({ref}) {
  const H = __mbv, el = H.get(ref);
  if (!el || !el.isConnected) return {gone: true};
  el.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
  const hit = H.hit(el);
  return {gone: false, rendered: H.rendered(el), hittable: hit.ok, x: hit.x, y: hit.y, desc: H.describe(el)};
}

function probeFocusRef({ref}) {
  const H = __mbv, el = H.get(ref);
  if (!el || !el.isConnected) return false;
  el.focus({preventScroll: false});
  return document.activeElement === el;
}

/** The page's own content: <main> when there is one, otherwise the body without header, nav and footer. A not-found
 * document title alone does not count: the visitor must see it. */
function probeUnknown() {
  const H = __mbv;
  const h1 = [...document.querySelectorAll('h1')].find(H.rendered);
  const main = document.querySelector('main, [role="main"]');
  let content = main ? H.text(main) : H.text(document.body);
  if (!main) for (const part of document.querySelectorAll('header, nav, footer')) content = content.replace(H.text(part), ' ');
  content = content.replace(/\s+/g, ' ').trim();
  const words = `${h1 ? H.text(h1) : ''} ${content.slice(0, 3000)}`;
  return {text: content.slice(0, 300), textLength: content.length, h1: h1 ? H.text(h1).slice(0, 120) : null, notFound: /\b(?:page not found|not found|404|couldn.?t find|could not find|doesn.?t exist|does not exist|no such page)\b/i.test(words), hash: location.hash, title: document.title};
}

function probeMenuToggle() {
  const H = __mbv;
  const name = /\bmenu\b|navigation|\bnav\b|☰|≡/i;
  const candidates = [...document.querySelectorAll('button, summary, [role="button"], a[aria-controls], a[aria-expanded]')].filter(el => {
    if (!H.rendered(el) || !H.inView(el.getBoundingClientRect())) return false;
    const label = H.name(el);
    if (/\bclose\b/i.test(label) && !el.hasAttribute('aria-expanded')) return false;
    const inNavDetails = el.tagName === 'SUMMARY' && el.closest('header, nav, [role="banner"]');
    return el.hasAttribute('aria-expanded') || el.hasAttribute('aria-controls') || inNavDetails || name.test(label);
  });
  candidates.sort((a, b) => Number(!!b.closest('header, nav, [role="banner"]')) - Number(!!a.closest('header, nav, [role="banner"]')) || a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const navLinks = [...document.querySelectorAll('nav a[href], header a[href]')];
  const visibleNav = navLinks.filter(link => H.rendered(link) && H.inView(link.getBoundingClientRect()) && H.opacity(link) > 0.1 && H.hit(link).ok).length;
  const toggle = candidates[0];
  if (!toggle) return {found: false, navLinks: navLinks.length, visibleNav};
  return {found: true, ref: H.ref(toggle), desc: H.describe(toggle), name: H.name(toggle).slice(0, 60), kind: toggle.tagName === 'SUMMARY' ? 'summary' : 'button', hasState: toggle.hasAttribute('aria-expanded') || toggle.tagName === 'SUMMARY', navLinks: navLinks.length, visibleNav};
}

function probeMenuState({ref}) {
  const H = __mbv, toggle = H.get(ref);
  if (!toggle || !toggle.isConnected) return {gone: true};
  const details = toggle.tagName === 'SUMMARY' ? toggle.closest('details') : null;
  const expanded = details ? details.open : toggle.getAttribute('aria-expanded') === 'true';
  const controls = (toggle.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)).filter(Boolean);
  const regions = details ? [details] : controls.length ? controls : [...document.querySelectorAll('nav, header')];
  const links = [...new Set(regions.flatMap(region => [...region.querySelectorAll('a[href]')]))].filter(link => link !== toggle && !link.contains(toggle));
  const visible = links.filter(link => H.rendered(link) && H.inView(link.getBoundingClientRect()) && H.opacity(link) > 0.1 && H.hit(link).ok);
  const active = document.activeElement;
  const lost = !active || active === document.body || active === document.documentElement;
  const close = [...document.querySelectorAll('button, [role="button"]')].find(el => el !== toggle && H.rendered(el) && H.hit(el).ok && (/\bclose\b/i.test(H.name(el)) || (el.getAttribute('aria-expanded') === 'true')));
  return {gone: false, expanded, visibleLinks: visible.length, sample: visible.slice(0, 3).map(link => H.text(link).slice(0, 30)), toggleHittable: H.rendered(toggle) && H.hit(toggle).ok, focus: lost ? 'body (focus lost)' : H.describe(active), focusLost: lost, closeRef: close ? H.ref(close) : -1, closeDesc: close ? H.describe(close) : null};
}

function probePrimary({limit}) {
  scrollTo({top: 0, left: 0, behavior: 'instant'});
  return __mbv.primary(limit);
}

function probeFocusable() {
  const H = __mbv;
  return [...document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')].filter(el => !el.disabled && el.tabIndex >= 0 && H.rendered(el)).length;
}

function probeFocus({prev, primaries}) {
  const H = __mbv, el = document.activeElement;
  const isBody = !el || el === document.body || el === document.documentElement;
  const out = {isBody};
  if (prev >= 0) { const previous = H.get(prev); out.prevUnfocused = previous && previous !== el && previous.isConnected ? H.focusStyle(previous) : null; }
  if (!isBody) {
    out.ref = H.ref(el); out.desc = H.describe(el); out.style = H.focusStyle(el);
    const r = el.getBoundingClientRect();
    out.rect = {x: r.left, y: r.top, width: r.width, height: r.height}; out.inView = H.rendered(el) && H.inView(r); out.scroll = [scrollX, scrollY];
    out.primary = primaries.includes(out.ref);
  }
  return out;
}

function probeScrollTo({x, y}) { scrollTo({left: x, top: y, behavior: 'instant'}); return [scrollX, scrollY]; }

function probeWatchStart() {
  const H = __mbv;
  if (H.watch?.observer) H.watch.observer.disconnect();
  const watch = H.watch = {count: 0, url: location.href, y: scrollY, active: document.activeElement, dialogs: document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]').length, forms: H.visibleForms()};
  watch.observer = new MutationObserver(list => { watch.count += list.length; });
  watch.observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true, characterData: true});
  return true;
}

function probeWatchEnd({anchor, clicked}) {
  const H = __mbv, watch = H.watch, own = H.get(clicked ?? -1);
  if (!watch) return null;
  watch.observer.disconnect();
  const active = document.activeElement;
  const dialogs = [...document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')].filter(H.rendered).length;
  const target = anchor ? document.getElementById(anchor) : null;
  return {
    mutations: watch.count, urlChanged: location.href !== watch.url, url: location.href, dy: scrollY - watch.y,
    newForm: H.visibleForms() > watch.forms, dialog: dialogs > watch.dialogs,
    // Clicking a button focuses the button itself: that is not an effect of the action.
    focusMoved: active && active !== watch.active && active !== document.body && !(own && (own === active || own.contains(active))) ? H.describe(active) : null,
    anchorTarget: !!target,
  };
}

function probeForms() {
  const H = __mbv;
  return [...document.forms].map(form => {
    const fields = [...form.elements].filter(field => ['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName)).map(field => {
      const type = (field.getAttribute('type') || field.tagName).toLowerCase();
      const labels = field.labels ? [...field.labels].map(H.text).join(' ') : '';
      const offscreen = (() => { const r = field.getBoundingClientRect(); return r.right < 0 || r.bottom < 0 || r.left > document.documentElement.scrollWidth; })();
      const honeypot = field.name === '_website' || (field.tabIndex < 0 && (!H.rendered(field) || offscreen)) || !!field.closest('[aria-hidden="true"]');
      return {ref: H.ref(field), tag: field.tagName.toLowerCase(), type, name: field.name || field.id || '', label: (labels || field.getAttribute('aria-label') || field.placeholder || '').slice(0, 60), autocomplete: field.getAttribute('autocomplete') || '', required: field.required || field.getAttribute('aria-required') === 'true', rendered: H.rendered(field), honeypot, options: field.tagName === 'SELECT' ? [...field.options].filter(option => option.value && !option.disabled).map(option => option.value).slice(0, 5) : null, min: field.getAttribute('min'), max: field.getAttribute('max')};
    });
    const submit = [...form.querySelectorAll('button, input[type="submit"]')].find(el => (el.tagName === 'BUTTON' ? (el.getAttribute('type') || 'submit') === 'submit' : true) && H.rendered(el))
      || (form.id ? [...document.querySelectorAll(`button[form="${CSS.escape(form.id)}"]`)].find(H.rendered) : null);
    const region = form.closest('section, article, aside, main, [role="dialog"]') || form.parentElement || form;
    return {ref: H.ref(form), regionRef: H.ref(region), desc: H.describe(form).slice(0, 80), action: form.getAttribute('action') || '', method: (form.getAttribute('method') || 'get').toLowerCase(), noValidate: form.noValidate, rendered: H.rendered(form), fields, submitRef: submit ? H.ref(submit) : -1, submitText: submit ? H.name(submit).slice(0, 40) : null};
  }).filter(form => form.rendered && form.fields.some(field => field.rendered && !field.honeypot));
}

function probeFormState({form, region}) {
  const H = __mbv, formEl = H.get(form), regionEl = H.get(region) || formEl;
  const fields = formEl && formEl.isConnected ? [...formEl.elements].filter(field => ['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName)) : [];
  const invalid = fields.filter(field => field.name !== '_website' && (field.matches(':invalid') || field.getAttribute('aria-invalid') === 'true')).map(field => field.name || field.id || field.type);
  const live = [...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]:not([aria-live="off"]), output')].filter(H.rendered).map(H.text).filter(Boolean);
  const blocks = [];
  const scope = regionEl && regionEl.isConnected ? regionEl : document.body;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && blocks.length < 200; node = walker.nextNode()) {
    const owner = node.parentElement, text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 4 || !owner || owner.closest('script, style, option, label, button') || !H.rendered(owner) || H.opacity(owner) < 0.1) continue;
    blocks.push(text.slice(0, 160));
  }
  return {connected: !!formEl?.isConnected, invalid, live, blocks, url: location.href, active: H.describe(document.activeElement)};
}

function probeSetValue({ref, value, check}) {
  const H = __mbv, el = H.get(ref);
  if (!el) return false;
  if (check !== undefined) { if (el.checked !== check) el.click(); return el.checked === check; }
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
  return el.value === value;
}

function probeReduced() {
  const H = __mbv;
  const collapsed = [...document.querySelectorAll('[aria-expanded="false"][aria-controls]')].flatMap(el => el.getAttribute('aria-controls').split(/\s+/)).map(id => document.getElementById(id)).filter(Boolean);
  const excluded = el => !!el.closest('nav, dialog:not([open]), [aria-hidden="true"], [inert], [hidden], [role="dialog"], [role="tooltip"]') || collapsed.some(region => region.contains(el));
  const insetHides = (value, r) => {
    const match = /^inset\(([^)]*)\)/.exec(value || ''); if (!match) return false;
    const parts = match[1].split(/\s+round\s+/)[0].trim().split(/\s+/);
    const [t, rt = t, b = t, l = rt] = parts;
    const amount = (v, size) => (v.endsWith('%') ? parseFloat(v) / 100 * size : parseFloat(v) || 0);
    return amount(t, r.height) + amount(b, r.height) >= r.height - 0.5 || amount(rt, r.width) + amount(l, r.width) >= r.width - 0.5;
  };
  const docWidth = document.documentElement.clientWidth;
  const hidden = [];
  let considered = 0;
  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'OPTION'].includes(el.tagName)) continue;
    const ownText = [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim().length >= 2);
    const media = ['IMG', 'VIDEO', 'CANVAS'].includes(el.tagName) || el instanceof SVGSVGElement;
    if (!ownText && !media) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2 || (media && r.width * r.height < 576)) continue;
    if (getComputedStyle(el).visibility !== 'visible' || excluded(el)) continue;
    considered++;
    let why = null;
    const opacity = H.opacity(el);
    if (opacity < 0.05) why = `opacity ${opacity.toFixed(2)}`;
    let transformed = false, scroller = false;
    for (let node = el; node && node.nodeType === 1 && node !== document.body && !why; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.transform && s.transform !== 'none') {
        transformed = true;
        const m = new DOMMatrixReadOnly(s.transform);
        if ((Math.abs(m.a) < 0.05 && Math.abs(m.b) < 0.05) || (Math.abs(m.d) < 0.05 && Math.abs(m.c) < 0.05)) why = `scaled to zero by ${H.describe(node).slice(0, 60)}`;
      }
      if (!why && s.clipPath && s.clipPath !== 'none' && insetHides(s.clipPath, node.getBoundingClientRect())) why = `clipped away by clip-path ${s.clipPath} on ${H.describe(node).slice(0, 60)}`;
      if (node !== el && ['hidden', 'clip', 'auto', 'scroll'].includes(s.overflowX)) scroller = true;
    }
    if (!why && transformed && !scroller && (r.right <= 0 || r.left >= docWidth)) why = 'transformed out of view';
    if (why) hidden.push({desc: H.describe(el).slice(0, 90), why});
  }
  const animations = document.getAnimations().filter(animation => animation.playState === 'running').map(animation => {
    const timing = animation.effect && animation.effect.getComputedTiming ? animation.effect.getComputedTiming() : {};
    const target = animation.effect && animation.effect.target;
    return {iterations: timing.iterations, name: animation.animationName || animation.transitionProperty || animation.id || 'animation', target: target && target.nodeType === 1 ? H.describe(target).slice(0, 60) : null, rendered: !!(target && target.nodeType === 1 && H.rendered(target))};
  }).filter(item => item.iterations === Infinity && item.rendered);
  return {considered, hidden: hidden.slice(0, 12), hiddenCount: hidden.length, animations: animations.slice(0, 8), animationCount: animations.length};
}

// ---------------------------------------------------------------- runner

const withTimeout = (promise, ms, code) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error(code), {code})), ms); })]).finally(() => clearTimeout(timer));
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const routeUrl = (origin, route) => (route === '/' ? `${origin}/` : `${origin}/#${route}`);
const fileSlug = value => String(value).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'root';

function validateInput({identity, site, routes, viewports, limits, only}) {
  if (!identity || typeof identity.artifactId !== 'string' || !identity.artifactId) throw Error('VERIFY_IDENTITY_INVALID');
  if (typeof site?.indexHtml !== 'string' || !Array.isArray(site.files)) throw Error('VERIFY_SITE_INVALID');
  for (const file of site.files) if (typeof file.path !== 'string' || !file.path.startsWith('/') || !Buffer.isBuffer(file.body) || typeof file.contentType !== 'string') throw Error('VERIFY_SITE_FILE_INVALID');
  const declared = (routes?.length ? routes : [{path: '/', title: 'Home'}]).map(route => ({path: normalPath(route.path), title: route.title ?? ''}));
  for (const route of declared) if (!/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(route.path)) throw Error(`VERIFY_ROUTE_INVALID: ${route.path}`);
  if (!declared.some(route => route.path === '/')) declared.unshift({path: '/', title: 'Home'});
  const unique = [...new Map(declared.map(route => [route.path, route])).values()];
  const sizes = (viewports?.length ? viewports : DEFAULT_VIEWPORTS).map(viewport => ({width: viewport.width, height: viewport.height}));
  for (const viewport of sizes) if (![viewport.width, viewport.height].every(value => Number.isInteger(value) && value >= 200 && value <= 3000)) throw Error('VERIFY_VIEWPORT_INVALID');
  if (only !== undefined && (!Array.isArray(only) || only.some(item => typeof item !== 'string'))) throw Error('VERIFY_ONLY_INVALID');
  return {routes: unique, viewports: sizes, limits: {...DEFAULT_LIMITS, ...(limits ?? {})}};
}

async function evidenceDirectory(requested) {
  const dir = requested ? path.resolve(requested) : await mkdtemp(path.join(tmpdir(), 'makeborne-site-verify-'));
  const outputs = path.join(REPO, 'outputs');
  const relative = path.relative(outputs, dir);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw Error('VERIFY_EVIDENCE_DIR_REFUSED: evidence never goes under the repository outputs/ folder');
  await mkdir(dir, {recursive: true});
  return dir;
}

/** The ordered work plan. Each unit produces results for the checks it lists. */
export function planUnits(routes, viewports) {
  const pair = (a, b) => [...new Set([a, b].filter(Boolean))];
  const desktop = viewports.reduce((a, b) => (b.width > a.width ? b : a));
  const phones = viewports.filter(isPhone);
  const phone = phones.find(viewport => viewport.width === 390) ?? phones.reduce((a, b) => (b.width < a.width ? b : a), phones[0] ?? null);
  const units = [{kind: 'version', checks: ['version'], route: null, viewport: null}];
  for (const viewport of viewports) for (const route of routes) units.push({kind: 'load', route: route.path, viewport, checks: ['route-load', 'overflow', 'occlusion', ...(isPhone(viewport) ? ['fixed-bars'] : [])]});
  for (const route of routes) units.push({kind: 'navigation', route: route.path, viewport: desktop, checks: ['navigation', 'external-links'], optional: ['external-links']});
  units.push({kind: 'unknown', route: UNKNOWN_ROUTE, viewport: desktop, checks: ['unknown-route']});
  for (const viewport of viewports.filter(isNarrow)) units.push({kind: 'menu', route: '/', viewport, checks: ['mobile-menu', 'mobile-menu-escape']});
  for (const route of routes) units.push({kind: 'keyboard', route: route.path, viewport: desktop, checks: ['keyboard-reach', 'focus-visible', 'keyboard-trap']});
  if (phone && phone !== desktop) units.push({kind: 'keyboard', route: '/', viewport: phone, checks: ['keyboard-reach', 'focus-visible', 'keyboard-trap']});
  for (const route of routes) for (const viewport of pair(phone, desktop)) units.push({kind: 'primary', route: route.path, viewport, checks: ['primary-action'], dynamic: true});
  for (const route of routes) units.push({kind: 'forms', route: route.path, viewport: desktop, checks: ['form-empty-submit', 'form-submit'], dynamic: true});
  for (const route of routes) for (const viewport of pair(phone, desktop)) units.push({kind: 'reduced', route: route.path, viewport, checks: ['reduced-motion']});
  return units;
}
const resultId = (check, route, viewport, suffix) => (check === 'version' ? 'version' : `${check}:${route}:${viewport ? label(viewport) : '-'}${suffix === undefined || suffix === null ? '' : `#${suffix}`}`);
const baseOf = id => id.replace(/#\d+$/, '');

/**
 * Verify one website. Returns a report; never throws for site defects (only for invalid input or an
 * unusable evidence directory). `only` limits the run to check names or result ids (used for rechecks).
 */
export async function verifySite({identity, site, routes, viewports, limits, only, origin = VERIFIER_ORIGIN, evidenceDir, screenshots = 'evidence', launch = launchIsolatedChromium}) {
  const input = validateInput({identity, site, routes, viewports, limits, only});
  const budget = new Budget(input.limits);
  const dir = await evidenceDirectory(evidenceDir);
  const startedAt = new Date().toISOString();
  const filter = only ? new Set(only) : null;
  const wanted = (check, id) => !filter || filter.has(check) || filter.has(id) || filter.has(baseOf(id));
  const report = {schema: REPORT_SCHEMA, identity: {...identity}, origin, startedAt, finishedAt: null, evidenceDir: dir, routes: input.routes, viewports: input.viewports.map(label), limits: input.limits, budget: null, results: [], summary: null, violations: [], network: {fulfilled: 0, sink: 0, aborted: 0, offOrigin: 0}, browser: null};
  const files = site.files.map(file => file.path);
  const env = {site, origin, routes: input.routes, files, budget, dir, report, chromium: null, screenshots, homeH1: null};
  const units = planUnits(input.routes, input.viewports).filter(unit => unit.checks.some(check => wanted(check, resultId(check, unit.route, unit.viewport))));
  let stopped = null;
  const killer = setTimeout(() => { stopped ??= 'time'; void env.chromium?.close(); }, input.limits.timeMs + 15_000);
  try {
    for (const unit of units) {
      const emitted = new Set(), pending = new Map();
      const emit = result => {
        pending.delete(result.id);
        if (!wanted(result.check, result.id) || emitted.has(result.id)) return;
        emitted.add(result.id); report.results.push(result);
      };
      const expect = (check, suffix, placeholder = false) => { const id = resultId(check, unit.route, unit.viewport, suffix); if (!emitted.has(id)) pending.set(id, {check, suffix, placeholder}); };
      const settle = reason => {
        for (const [id, item] of pending) emit({id, check: item.check, route: unit.route, viewport: unit.viewport ? label(unit.viewport) : null, steps: [], expected: EXPECTED[item.check], observed: null, evidence: {screenshot: null, log: []}, status: 'not_checked', reason});
      };
      for (const check of unit.checks) if (!unit.optional?.includes(check)) expect(check, undefined, !!unit.dynamic);
      const by = stopped ?? budget.exhaustedBy();
      if (by) { settle(by === 'time' ? 'time budget exhausted before this check ran' : 'step budget exhausted before this check ran'); continue; }
      try {
        if (unit.kind !== 'version' && !env.chromium) { env.chromium = await launch(); report.browser = `chromium ${env.chromium.version}`; }
        const tools = {emit, expect, resolve: () => { for (const [id, item] of pending) if (item.placeholder) pending.delete(id); }};
        await withTimeout(UNITS[unit.kind](env, unit, tools), Math.max(1000, budget.remainingMs()), 'TIME_BUDGET');
        settle('the check ended without a result');
      } catch (error) {
        if (error instanceof BudgetExhausted) { stopped = error.kind; settle(`${error.message} during this check`); }
        else if (error.code === 'TIME_BUDGET') { stopped = 'time'; settle('time budget exhausted during this check'); }
        else if (error.code === 'PROBE_TIMEOUT') settle('the page stopped responding (a probe timed out); the browser was restarted');
        else settle(`verifier error: ${String(error.message).slice(0, 200)}`);
        if (error.code === 'TIME_BUDGET' || error.code === 'PROBE_TIMEOUT' || /Target (?:page, context or browser )?(?:has been )?closed|crashed|Browser has been closed/i.test(error.message)) {
          await env.chromium?.close(); env.chromium = null;
        }
      }
    }
  } finally {
    clearTimeout(killer);
    await env.chromium?.close();
  }
  report.finishedAt = new Date().toISOString();
  report.budget = {steps: budget.steps, maxSteps: budget.maxSteps, elapsedMs: budget.timeMs - budget.remainingMs(), stopped};
  report.summary = {passed: 0, failed: 0, not_checked: 0};
  for (const result of report.results) report.summary[result.status]++;
  return report;
}

const EXPECTED = {
  'version': 'the verified bytes match the publication digest',
  'route-load': 'the route renders content with a visible h1, no runtime or console errors, no missing assets or blocked requests, no broken images',
  'overflow': 'no horizontal scrolling at this width',
  'occlusion': 'the h1 and the first-screen primary action are not covered by another element',
  'fixed-bars': `fixed or stuck elements cover at most ${FIXED_SHARE.single * 100}% (one) / ${FIXED_SHARE.total * 100}% (all) of a phone screen`,
  'navigation': 'every internal link resolves to a declared route or an existing anchor',
  'external-links': 'external and contact links are listed, never followed',
  'unknown-route': 'an unknown route shows a not-found state or home, without a runtime error',
  'mobile-menu': 'the menu toggle opens the menu (expanded, links visible) and closes it again',
  'mobile-menu-escape': 'Escape closes the open menu and focus stays on the toggle or in the header',
  'keyboard-reach': `Tab reaches the primary action within ${TAB_REACH_BOUND} stops`,
  'focus-visible': 'every focused element shows a visible focus indicator',
  'keyboard-trap': 'Tab keeps moving through the page (no keyboard trap)',
  'primary-action': 'the primary action navigates to a declared route or anchor, opens a form, changes the page, or is a tel:/mailto:/https link',
  'form-empty-submit': 'submitting the empty form marks required fields invalid or shows an error, and sends nothing',
  'form-submit': 'a filled form sends exactly one enquiry to /_mb/enquiries and shows a visible status, or says honestly that nothing is sent',
  'reduced-motion': 'with reduced motion no content stays invisible or transformed away, and no infinite animation runs',
};

/** One locked-down session for a unit. */
async function session(env, unit, {reducedMotion = 'no-preference'} = {}) {
  const opened = await openSiteContext(env.chromium.browser, {site: env.site, origin: env.origin, viewport: unit.viewport, reducedMotion});
  const world = trustedWorld(opened.page, opened.cdp, {prelude: verifierPrelude});
  const steps = [];
  const s = {
    ...opened, world, steps,
    run: (fn, arg, options) => world.run(fn, arg, options),
    async goto(route, {ready = true} = {}) {
      env.budget.step();
      const url = routeUrl(env.origin, route);
      steps.push(`open ${url} at ${label(unit.viewport)}${reducedMotion === 'reduce' ? ' (prefers-reduced-motion: reduce)' : ''}`);
      world.reset();
      await opened.page.goto(url, {waitUntil: 'load', timeout: Math.max(1000, Math.min(15_000, env.budget.remainingMs()))});
      await opened.page.waitForLoadState('networkidle', {timeout: 2000}).catch(() => {});
      return ready ? world.run(probeReady, {waitMs: 5000}, {timeoutMs: 9000}) : null;
    },
    async reload(route) { await opened.page.goto('about:blank'); return s.goto(route); },
    async click(ref, what) {
      env.budget.step();
      const target = await world.run(probeClickTarget, {ref});
      if (target.gone || !target.rendered) { steps.push(`${what}: element is gone or not rendered`); return false; }
      if (target.hittable) { steps.push(`click ${what} (${target.desc}) at ${Math.round(target.x)},${Math.round(target.y)}`); await opened.page.mouse.click(target.x, target.y); return true; }
      steps.push(`${what} (${target.desc}) is covered; focus it and press Enter`);
      if (!(await world.run(probeFocusRef, {ref}))) return false;
      await opened.page.keyboard.press('Enter');
      return true;
    },
    async key(key, note) { env.budget.step(); steps.push(note ?? `press ${key}`); await opened.page.keyboard.press(key); },
    async shot(name) {
      if (env.screenshots === 'none') return null;
      const file = path.join(env.dir, `${fileSlug(name)}.png`);
      try { await opened.page.screenshot({path: file, timeout: 5000}); return file; } catch { return null; }
    },
    collect() {
      const {ledger} = opened, report = env.report;
      for (const request of ledger.requests) { if (request.outcome === 'fulfilled') report.network.fulfilled++; else if (request.outcome === 'sink') report.network.sink++; else report.network.aborted++; if (request.reason === 'off-origin') report.network.offOrigin++; }
      for (const violation of ledger.violations) {
        if (!report.violations.some(item => item.kind === violation.kind && item.url === violation.url && item.route === unit.route)) report.violations.push({...violation, route: unit.route, viewport: label(unit.viewport), unit: unit.kind});
      }
      report.network.offOrigin += ledger.blocked.filter(item => item.url && !item.url.startsWith(env.origin) && /^https?:|^wss?:/.test(item.url)).length;
    },
    async close() { s.collect(); await opened.close(); },
  };
  return s;
}
const make = (unit, check, fields, suffix) => ({id: resultId(check, unit.route, unit.viewport, suffix), check, route: unit.route, viewport: unit.viewport ? label(unit.viewport) : null, expected: EXPECTED[check], reason: undefined, ...fields, evidence: {screenshot: fields.evidence?.screenshot ?? null, log: fields.evidence?.log ?? []}});
const logOf = ledger => [
  ...ledger.pageErrors.map(text => `pageerror: ${text}`), ...ledger.consoleErrors.map(text => `console: ${text}`),
  ...ledger.requests.filter(item => item.outcome === 'aborted').map(item => `aborted ${item.method} ${item.url} (${item.reason || 'aborted'}, ${item.type})`),
  ...ledger.violations.map(item => `violation ${item.kind}: ${item.method ? `${item.method} ` : ''}${item.url}${item.blockedBy ? ` (blocked by ${item.blockedBy})` : ''}`),
];

const UNITS = {
  async version(env, unit, {emit}) {
    const digest = siteDigest(env.site), expected = env.report.identity.publicationDigest;
    const base = {steps: [`digest the verified bytes (${env.site.files.length} files + document)`], evidence: {log: [`verified digest ${digest}`]}};
    if (!expected) emit(make(unit, 'version', {...base, observed: `verified ${digest}; artifact ${env.report.identity.artifactId} version ${env.report.identity.version ?? '?'}`, status: 'not_checked', reason: 'no publication digest was given to compare'}));
    else emit(make(unit, 'version', {...base, observed: `verified ${digest}`, status: expected === digest ? 'passed' : 'failed', reason: expected === digest ? undefined : `the verified bytes are not the publication ${expected}`}));
  },

  async load(env, unit, {emit}) {
    const s = await session(env, unit);
    try {
      let ready;
      try { ready = await s.goto(unit.route); }
      catch (error) {
        if (error.code !== 'PROBE_TIMEOUT' && error.name !== 'TimeoutError') throw error;
        emit(make(unit, 'route-load', {steps: s.steps, observed: error.code === 'PROBE_TIMEOUT' ? 'the page stopped responding while loading (main thread busy for more than 9 s)' : 'the document did not finish loading in time', status: 'failed', reason: 'the route never finished loading', evidence: {screenshot: null, log: logOf(s.ledger)}}));
        throw Object.assign(Error('PROBE_TIMEOUT'), {code: 'PROBE_TIMEOUT'});
      }
      const shot = await s.shot(`load${unit.route}-${label(unit.viewport)}`);
      const load = await s.run(probeLoad);
      const problems = [];
      if (!ready.rootReady) problems.push('the root element never rendered any content within 5 s');
      const h1 = load.h1s.filter(item => item.rendered);
      if (ready.rootReady && !h1.length) problems.push(load.h1s.length ? 'the page has an h1 but it is not rendered' : 'no h1 on the page');
      if (unit.route !== UNKNOWN_ROUTE && load.notFound && h1.some(item => /not found|404/i.test(item.text))) problems.push(`the declared route renders a not-found page ("${h1[0].text}")`);
      for (const text of s.ledger.pageErrors.slice(0, 3)) problems.push(`runtime error: ${text}`);
      for (const text of s.ledger.consoleErrors.slice(0, 3)) problems.push(`console error: ${text}`);
      const missing = s.ledger.requests.filter(item => item.reason === 'unlisted');
      if (missing.length) problems.push(`missing asset${missing.length > 1 ? 's' : ''}: ${missing.slice(0, 4).map(item => `${item.url.replace(env.origin, '')} (${item.type})`).join(', ')}`);
      const blocked = s.ledger.violations.filter(item => item.kind !== 'download');
      if (blocked.length) problems.push(`blocked request${blocked.length > 1 ? 's' : ''}: ${blocked.slice(0, 3).map(item => `${item.kind} ${item.url}`).join(', ')}`);
      if (load.broken.length) problems.push(`broken image${load.broken.length > 1 ? 's' : ''} (naturalWidth 0): ${load.broken.slice(0, 4).map(item => item.src.replace(env.origin, '') || '(empty src)').join(', ')}`);
      if (ready.failedFonts?.length) problems.push(`font failed to load: ${ready.failedFonts.join(', ')}`);
      if (unit.route === '/' && h1.length) env.homeH1 ??= h1[0].text;
      const loadSteps = [...s.steps];
      emit(make(unit, 'route-load', {steps: [...loadSteps, 'read root, h1, images, errors and the request ledger (isolated world + Playwright)'], observed: problems.length ? problems.join('; ') : `rendered "${h1[0]?.text ?? ''}"; ${load.images} image(s) loaded; ${s.ledger.requests.length} request(s), all served from the verified bytes`, status: problems.length ? 'failed' : 'passed', reason: problems.length ? problems[0] : undefined, evidence: {screenshot: shot, log: logOf(s.ledger)}}));
      if (!ready.rootReady) {
        for (const check of unit.checks.slice(1)) emit(make(unit, check, {steps: loadSteps, observed: 'the route did not render', status: 'not_checked', reason: 'the page never rendered'}));
        return;
      }
      const overflow = await s.run(probeOverflow);
      const overflowing = overflow.overflowPx > 1 && !overflow.rootClips;
      emit(make(unit, 'overflow', {steps: [...loadSteps, 'measure document scroll width against the viewport (isolated world)'], observed: overflowing ? `the page scrolls ${overflow.overflowPx} px sideways at ${overflow.viewport} px${overflow.offenders.length ? `; widest offenders: ${overflow.offenders.slice(0, 3).map(item => `${item.desc} (right ${item.right})`).join(', ')}` : ''}` : overflow.rootClips && overflow.offenders.length ? `no sideways scroll (the root clips overflow-x); ${overflow.offenders.length} element(s) extend past the edge and are cut off: ${overflow.offenders.slice(0, 2).map(item => item.desc).join(', ')}` : `no sideways scroll (scroll width ${overflow.scrollWidth} px)`, status: overflowing ? 'failed' : 'passed', reason: overflowing ? 'content is wider than the viewport' : undefined, evidence: {screenshot: overflowing ? shot : null, log: overflow.offenders.map(item => JSON.stringify(item))}}));
      const primaries = await s.run(probePrimary, {limit: 2});
      const occlusion = await s.run(probeOcclusion, {refs: primaries.map(item => item.ref)});
      const covered = occlusion.filter(item => item.inside && item.covered);
      const measured = occlusion.filter(item => item.inside);
      emit(make(unit, 'occlusion', {steps: [...loadSteps, 'scroll to top', 'hit-test the centre of the h1 and the primary action (elementFromPoint, isolated world)'], observed: !measured.length ? 'neither the h1 nor a primary action is inside the first screen' : covered.length ? covered.map(item => `${item.role} ${item.desc} is covered by ${item.by}${item.byPosition && item.byPosition !== 'static' ? ` (${item.byPosition}${item.byLayer && item.byLayer !== item.by ? ` layer ${item.byLayer}` : ''})` : ''}`).join('; ') : `not covered: ${measured.map(item => `${item.role} ${item.desc}`).join(', ')}`, status: !measured.length ? 'not_checked' : covered.length ? 'failed' : 'passed', reason: !measured.length ? 'nothing to hit-test in the first screen' : covered.length ? 'a first-screen element is painted over' : undefined, evidence: {screenshot: covered.length ? shot : null, log: occlusion.map(item => JSON.stringify(item))}}));
      if (isPhone(unit.viewport)) {
        const top = await s.run(probeFixed);
        env.budget.step();
        const scroll = await s.run(probeScroll, {to: 'mid'});
        await wait(400);
        const mid = await s.run(probeFixed);
        const worst = [top, mid].flatMap(sample => sample.layers.map(layer => ({...layer, scrollY: sample.scrollY})));
        const single = worst.filter(layer => layer.share > FIXED_SHARE.single);
        const total = Math.max(top.total, mid.total);
        const failed = single.length > 0 || total > FIXED_SHARE.total;
        const midShot = failed ? await s.shot(`fixed${unit.route}-${label(unit.viewport)}-mid`) : null;
        emit(make(unit, 'fixed-bars', {steps: [...loadSteps, 'sample a 15x25 grid of hit tests at the top', `scroll to ${scroll.y} px`, 'sample again'], observed: worst.length ? `${worst.slice(0, 4).map(layer => `${layer.desc} (${layer.position}) covers ${Math.round(layer.share * 100)}% at scroll ${layer.scrollY}`).join('; ')}; all together up to ${Math.round(total * 100)}%` : 'no fixed or stuck element covers the screen', status: failed ? 'failed' : 'passed', reason: failed ? 'a fixed or sticky element covers too much of the phone screen' : undefined, evidence: {screenshot: midShot, log: [JSON.stringify(top), JSON.stringify(mid)]}}));
      }
    } finally { await s.close(); }
  },

  async navigation(env, unit, {emit}) {
    const s = await session(env, unit);
    try {
      const ready = await s.goto(unit.route);
      if (!ready.rootReady) { emit(make(unit, 'navigation', {steps: s.steps, observed: 'the route did not render', status: 'not_checked', reason: 'the page never rendered, so its links could not be read'})); return; }
      const first = await s.run(probeLinks);
      const seen = new Map();
      for (const link of first.links) if (!seen.has(link.raw)) seen.set(link.raw, {...link, info: classifyLink(link.raw, {origin: env.origin, routes: env.routes, files: env.files})});
      const broken = [], external = [], resolved = [], dynamic = [];
      for (const link of seen.values()) {
        const {info} = link, name = `${link.raw}${link.text ? ` ("${link.text}")` : ''}`;
        if (info.kind === 'external' || info.kind === 'contact' || info.kind === 'other') external.push(name);
        else if (info.kind === 'route') (info.declared ? resolved : broken).push(info.declared ? name : {link: name, why: `#${info.path} is not a declared route (${env.routes.map(route => route.path).join(', ')})`});
        else if (info.kind === 'file') resolved.push(name);
        else if (info.kind === 'anchor') {
          if (info.anchor === 'top' || (first.ids.includes(info.anchor) && (!info.home || unit.route === '/'))) resolved.push(name); else dynamic.push(link);
        } else if (info.kind === 'path') { if (info.path === '/') resolved.push(name); else if (!info.declared) broken.push({link: name, why: `${info.path} is neither a declared route nor a file of the site`}); else dynamic.push(link); }
        else if (info.kind === 'script') broken.push({link: name, why: 'javascript: URL instead of a link target'});
        else if (info.kind === 'empty' || info.kind === 'invalid') broken.push({link: name || '(empty href)', why: `${info.kind} href`});
      }
      const log = [];
      for (const link of dynamic.slice(0, 8)) {
        const name = `${link.raw}${link.text ? ` ("${link.text}")` : ''}`;
        await s.reload(unit.route);
        const fresh = await s.run(probeLinks);
        const again = fresh.links.find(item => item.raw === link.raw);
        if (link.info.kind === 'path') {
          // A declared route written as a path: does the document at that path render the same page as the hash route?
          env.budget.step();
          s.steps.push(`open ${env.origin}${link.info.path}`);
          s.world.reset();
          await s.page.goto(`${env.origin}${link.info.path}`, {waitUntil: 'load', timeout: 15_000});
          await s.run(probeReady, {waitMs: 4000}, {timeoutMs: 8000});
          const atPath = await s.run(probeAnchor, {anchor: '__none__'});
          await s.goto(link.info.path);
          const atRoute = await s.run(probeAnchor, {anchor: '__none__'});
          log.push(`${link.raw}: path renders "${atPath.h1}", route #${link.info.path} renders "${atRoute.h1}"`);
          if (atPath.h1 && atPath.h1 === atRoute.h1) resolved.push(name); else broken.push({link: name, why: `the path ${link.info.path} renders "${atPath.h1 ?? 'no h1'}", not the declared route's page ("${atRoute.h1 ?? 'no h1'}"): use #${link.info.path}`});
          continue;
        }
        if (again?.hittable) await s.click(again.ref, `link ${link.raw}`);
        else { env.budget.step(); s.steps.push(`set location to ${link.raw} (link not clickable here)`); await s.run(({href}) => { location.href = new URL(href, location.href).href; return true; }, {href: link.raw}); }
        await wait(700);
        await s.run(probeReady, {waitMs: 3000}, {timeoutMs: 8000}).catch(() => null);
        const where = await s.run(probeAnchor, {anchor: link.info.anchor});
        log.push(`${link.raw}: ${JSON.stringify(where)}`);
        if (where.exists && where.inView) resolved.push(name);
        else broken.push({link: name, why: where.exists ? `the target #${link.info.anchor} exists but is not scrolled into view (top ${where.top} px)` : `no element with id="${link.info.anchor}" ${link.info.home ? 'on the home page' : `on ${unit.route} or after following the link`}`});
      }
      for (const link of dynamic.slice(8)) broken.push({link: link.raw, why: 'not verified (more than 8 links needed a follow-up)', unverified: true});
      const real = broken.filter(item => !item.unverified);
      emit(make(unit, 'navigation', {steps: [...s.steps, `classify ${seen.size} unique link(s) against ${env.routes.length} declared route(s) and the page's ids`], observed: real.length ? real.map(item => `${item.link}: ${item.why}`).join('; ') : `${resolved.length} internal link(s) resolve${external.length ? `; ${external.length} external/contact link(s) listed` : ''}`, status: real.length ? 'failed' : resolved.length || !broken.length ? 'passed' : 'not_checked', reason: real.length ? 'internal links lead nowhere' : undefined, evidence: {screenshot: null, log: [...log, ...broken.filter(item => item.unverified).map(item => `unverified: ${item.link}`)]}}));
      if (external.length) emit(make(unit, 'external-links', {steps: ['list external, tel:, mailto: and other-scheme links without following them'], observed: external.slice(0, 20).join(', '), status: 'not_checked', reason: 'external links are never followed by the verifier'}));
    } finally { await s.close(); }
  },

  async unknown(env, unit, {emit}) {
    const s = await session(env, unit);
    try {
      await s.goto('/');
      const home = await s.run(probeUnknown);
      await s.reload(UNKNOWN_ROUTE);
      const page = await s.run(probeUnknown);
      const shot = await s.shot(`unknown-route-${label(unit.viewport)}`);
      const errors = [...s.ledger.pageErrors];
      const back = page.hash === '' || page.hash === '#' || page.hash === '#/';
      let status = 'failed', observed, reason;
      if (errors.length) { observed = `runtime error: ${errors[0]}`; reason = 'the unknown route throws'; }
      else if (!page.textLength && !page.h1) { observed = `the page content is blank${page.title ? ` (only the document title says "${page.title}")` : ''}`; reason = 'an unknown route renders nothing'; }
      else if (page.notFound) { status = 'passed'; observed = `shows a not-found state ("${page.h1 ?? page.title}")`; }
      else if (back || (page.h1 && page.h1 === home.h1)) { status = 'passed'; observed = `returns home ("${page.h1}")`; }
      else { observed = `renders "${page.h1 ?? page.text.slice(0, 80)}", neither a not-found state nor home`; reason = 'an unknown route shows unrelated content'; }
      emit(make(unit, 'unknown-route', {steps: [...s.steps, 'read the rendered text, h1 and hash (isolated world)'], observed, status, reason, evidence: {screenshot: shot, log: logOf(s.ledger)}}));
    } finally { await s.close(); }
  },

  async menu(env, unit, {emit}) {
    const s = await session(env, unit);
    try {
      await s.goto('/');
      const toggle = await s.run(probeMenuToggle);
      if (!toggle.found) {
        const navOk = toggle.visibleNav >= 2 || toggle.navLinks === 0;
        const outcome = toggle.navLinks === 0 ? {status: 'not_checked', observed: 'no navigation links in a header or nav', reason: 'the site has no navigation to open'}
          : navOk ? {status: 'not_checked', observed: `${toggle.visibleNav} navigation link(s) are visible without a toggle`, reason: 'the navigation needs no toggle at this width'}
          : {status: 'failed', observed: `${toggle.navLinks} navigation link(s) exist but ${toggle.visibleNav} are visible and no menu toggle was found (no aria-expanded/aria-controls, no summary, no element named "menu")`, reason: 'the navigation is hidden at this width with no recognisable way to open it'};
        emit(make(unit, 'mobile-menu', {steps: [...s.steps, 'look for a menu toggle'], ...outcome, evidence: {screenshot: outcome.status === 'failed' ? await s.shot(`menu-${label(unit.viewport)}`) : null, log: []}}));
        emit(make(unit, 'mobile-menu-escape', {steps: [], observed: outcome.observed, status: 'not_checked', reason: outcome.status === 'failed' ? 'no menu toggle to test' : outcome.reason}));
        return;
      }
      const before = await s.run(probeMenuState, {ref: toggle.ref});
      const log = [`toggle ${toggle.desc} (${toggle.kind}${toggle.hasState ? ', exposes state' : ', no aria-expanded'})`, `closed: ${JSON.stringify(before)}`];
      if (before.expanded) {
        emit(make(unit, 'mobile-menu', {steps: s.steps, observed: `the menu is already open on load (${before.visibleLinks} links visible)`, status: 'failed', reason: 'the phone menu starts expanded', evidence: {screenshot: await s.shot(`menu-${label(unit.viewport)}`), log}}));
        emit(make(unit, 'mobile-menu-escape', {steps: [], observed: 'menu starts open', status: 'not_checked', reason: 'the menu did not start closed'}));
        return;
      }
      await s.click(toggle.ref, `menu toggle "${toggle.name}"`);
      await wait(500);
      const open = await s.run(probeMenuState, {ref: toggle.ref});
      log.push(`after open: ${JSON.stringify(open)}`);
      const opened = !open.gone && (toggle.hasState ? open.expanded : true) && open.visibleLinks > before.visibleLinks && open.visibleLinks > 0;
      const openShot = await s.shot(`menu-open-${label(unit.viewport)}`);
      if (!opened) {
        emit(make(unit, 'mobile-menu', {steps: s.steps, observed: open.gone ? 'the toggle disappeared after the click' : `after the click: ${toggle.hasState ? `expanded=${open.expanded}, ` : ''}${open.visibleLinks} menu link(s) visible`, status: 'failed', reason: 'the menu never opens', evidence: {screenshot: openShot, log}}));
        emit(make(unit, 'mobile-menu-escape', {steps: [], observed: 'the menu did not open', status: 'not_checked', reason: 'the menu did not open, so closing could not be tested'}));
        return;
      }
      const closeRef = open.toggleHittable ? toggle.ref : open.closeRef;
      let closed = null;
      if (closeRef >= 0) {
        await s.click(closeRef, closeRef === toggle.ref ? 'menu toggle again' : `close button ${open.closeDesc}`);
        await wait(500);
        closed = await s.run(probeMenuState, {ref: toggle.ref});
        log.push(`after close: ${JSON.stringify(closed)}`);
      }
      const closes = closed && !closed.gone && (toggle.hasState ? !closed.expanded : true) && closed.visibleLinks <= before.visibleLinks;
      emit(make(unit, 'mobile-menu', {steps: [...s.steps], observed: `opened: ${open.visibleLinks} link(s) visible (${open.sample.join(', ')}); focus on ${open.focus}. ${closeRef < 0 ? 'No visible control could close it (the toggle is covered and there is no close button)' : closes ? 'Closed again by the toggle' : `After closing: ${toggle.hasState ? `expanded=${closed.expanded}, ` : ''}${closed.visibleLinks} link(s) still visible`}`, status: closes ? 'passed' : 'failed', reason: closes ? undefined : 'the open menu cannot be closed with its toggle', evidence: {screenshot: closes ? null : openShot, log}}));
      // Escape: reopen with the toggle, press Escape (focus on the toggle); if still open, Tab into the menu and press Escape again.
      if (!closes) { await s.reload('/'); }
      await s.click(toggle.ref, 'menu toggle (reopen)');
      await wait(500);
      const reopened = await s.run(probeMenuState, {ref: toggle.ref});
      if (!reopened.expanded && toggle.hasState) { emit(make(unit, 'mobile-menu-escape', {steps: s.steps, observed: 'the menu did not reopen', status: 'not_checked', reason: 'could not reopen the menu to test Escape'})); return; }
      await s.key('Escape', 'press Escape (focus on the toggle)');
      await wait(400);
      let escaped = await s.run(probeMenuState, {ref: toggle.ref});
      if ((toggle.hasState ? escaped.expanded : escaped.visibleLinks > before.visibleLinks)) {
        await s.key('Tab', 'press Tab (into the menu)');
        await s.key('Escape', 'press Escape (focus in the menu)');
        await wait(400);
        escaped = await s.run(probeMenuState, {ref: toggle.ref});
      }
      log.push(`after Escape: ${JSON.stringify(escaped)}`);
      const shut = (toggle.hasState ? !escaped.expanded : true) && escaped.visibleLinks <= before.visibleLinks;
      const shot = shut && !escaped.focusLost ? null : await s.shot(`menu-escape-${label(unit.viewport)}`);
      emit(make(unit, 'mobile-menu-escape', {steps: s.steps, observed: shut ? `Escape closed the menu; focus on ${escaped.focus}` : `after Escape the menu is still open (${toggle.hasState ? `expanded=${escaped.expanded}, ` : ''}${escaped.visibleLinks} link(s) visible)`, status: shut && !escaped.focusLost ? 'passed' : 'failed', reason: !shut ? `the menu cannot be closed with Escape${toggle.kind === 'summary' ? ' (a <details> menu needs a keydown handler that closes it)' : ''}` : escaped.focusLost ? 'Escape closed the menu but focus was lost to the page body' : undefined, evidence: {screenshot: shot, log}}));
    } finally { await s.close(); }
  },

  async keyboard(env, unit, {emit}) {
    const s = await session(env, unit);
    try {
      const ready = await s.goto(unit.route);
      if (!ready.rootReady) { for (const check of unit.checks) emit(make(unit, check, {steps: s.steps, observed: 'the route did not render', status: 'not_checked', reason: 'the page never rendered'})); return; }
      const primaries = await s.run(probePrimary, {limit: 2});
      const focusable = await s.run(probeFocusable);
      const stops = [];
      let prev = -1, reachedAt = null, reachedDesc = null;
      for (let press = 1; press <= TAB_PRESSES; press++) {
        env.budget.step();
        await s.page.keyboard.press('Tab');
        const now = await s.run(probeFocus, {prev, primaries: primaries.map(item => item.ref)});
        if (stops.length && now.prevUnfocused !== undefined) stops[stops.length - 1].unfocused = now.prevUnfocused;
        if (now.isBody) { stops.push({body: true}); prev = -1; continue; }
        const stop = {ref: now.ref, desc: now.desc, focused: now.style, inView: now.inView, rect: now.rect, scroll: now.scroll, primary: now.primary};
        if (now.inView && stops.filter(item => item.clip).length < FOCUS_SAMPLES) {
          const clip = {x: Math.max(0, now.rect.x - 4), y: Math.max(0, now.rect.y - 4)};
          clip.width = Math.min(unit.viewport.width - clip.x, now.rect.width + 8); clip.height = Math.min(unit.viewport.height - clip.y, now.rect.height + 8);
          if (clip.width >= 2 && clip.height >= 2) { stop.clipBox = clip; stop.clip = await s.page.screenshot({clip, timeout: 5000, caret: 'hide'}).catch(() => null); }
        }
        stops.push(stop);
        if (now.primary && reachedAt === null) { reachedAt = stops.length; reachedDesc = now.desc; }
        prev = now.ref;
        const firstReal = stops.findIndex(item => !item.body);
        const previousReal = stops.slice(0, -1).reverse().find(item => !item.body);
        // Wrapped around (the whole order was seen); a repeat of the previous stop is a stuck focus, not a wrap.
        if (firstReal < stops.length - 1 && stops[firstReal].ref === now.ref && previousReal && previousReal.ref !== now.ref && focusable > 1) break;
      }
      s.steps.push(`press Tab up to ${TAB_PRESSES} times (${stops.length} stop(s)); read the focused element and its computed focus styles after each press (isolated world)`);
      // Focus indicator: focused vs unfocused computed styles (element, ::before/::after, parent); a pixel comparison of the same clip confirms before failing.
      const missing = [];
      let evaluated = 0;
      for (const stop of stops) {
        if (stop.body || !stop.inView || !stop.clip || stop.unfocused === undefined || stop.unfocused === null) continue;
        evaluated++;
        if (stop.focused !== stop.unfocused) continue;
        await s.run(probeScrollTo, {x: stop.scroll[0], y: stop.scroll[1]});
        const after = await s.page.screenshot({clip: stop.clipBox, timeout: 5000, caret: 'hide'}).catch(() => null);
        if (after && !after.equals(stop.clip)) continue;
        missing.push(stop.desc);
      }
      const real = stops.filter(stop => !stop.body);
      const last = real.slice(-12).map(stop => stop.ref);
      const stuck = focusable > 1 && real.some((stop, index) => index >= 2 && real[index - 1].ref === stop.ref && real[index - 2].ref === stop.ref);
      const looping = real.length >= TAB_PRESSES - 2 && new Set(last).size <= 2 && focusable > 4;
      const sequence = real.slice(0, 14).map(stop => stop.desc).join(' → ');
      const primary = primaries[0];
      if (!primary) emit(make(unit, 'keyboard-reach', {steps: s.steps, observed: 'no primary action was identified in the first screen', status: 'not_checked', reason: 'nothing to reach'}));
      else emit(make(unit, 'keyboard-reach', {steps: s.steps, observed: reachedAt !== null && reachedAt <= TAB_REACH_BOUND ? `reached ${reachedDesc} at Tab stop ${reachedAt}` : reachedAt !== null ? `reached the primary action only at Tab stop ${reachedAt}` : `${primary.desc} was not reached in ${TAB_PRESSES} Tab presses; order: ${sequence || '(nothing focusable)'}`, status: reachedAt !== null && reachedAt <= TAB_REACH_BOUND ? 'passed' : 'failed', reason: reachedAt !== null && reachedAt <= TAB_REACH_BOUND ? undefined : 'keyboard users cannot reach the primary action quickly', evidence: {screenshot: null, log: [sequence]}}));
      emit(make(unit, 'focus-visible', {steps: s.steps, observed: !evaluated ? 'no focused element could be compared' : missing.length ? `no visible focus change on ${missing.slice(0, 5).join(', ')}` : `${evaluated} focused element(s) all show a focus indicator`, status: !evaluated ? 'not_checked' : missing.length ? 'failed' : 'passed', reason: !evaluated ? 'nothing focusable was compared in the viewport' : missing.length ? 'focus is invisible on some elements (outline removed without a replacement)' : undefined, evidence: {screenshot: null, log: []}}));
      emit(make(unit, 'keyboard-trap', {steps: s.steps, observed: !real.length ? 'Tab focused nothing' : stuck || looping ? `focus stays on ${[...new Set(last)].length} element(s): ${real.slice(-3).map(stop => stop.desc).join(' → ')}` : `focus moved through ${new Set(real.map(stop => stop.ref)).size} element(s)`, status: !real.length ? 'not_checked' : stuck || looping ? 'failed' : 'passed', reason: !real.length ? 'nothing focusable' : stuck || looping ? 'keyboard trap: Tab cannot move on' : undefined, evidence: {screenshot: null, log: []}}));
    } finally { await s.close(); }
  },

  async primary(env, unit, {emit, expect, resolve}) {
    const s = await session(env, unit);
    try {
      const ready = await s.goto(unit.route);
      if (!ready.rootReady) { emit(make(unit, 'primary-action', {steps: s.steps, observed: 'the route did not render', status: 'not_checked', reason: 'the page never rendered'})); return; }
      const found = await s.run(probePrimary, {limit: 2});
      resolve();
      if (!found.length) { emit(make(unit, 'primary-action', {steps: [...s.steps, 'look for button-styled actions in the first screen'], observed: 'no button-styled link or button in the first screen', status: 'not_checked', reason: 'no primary action identified'})); return; }
      found.forEach((_, index) => expect('primary-action', index));
      for (const [index, first] of found.entries()) {
        const mark = s.steps.length;
        let candidate = first;
        if (index > 0) { await s.reload(unit.route); candidate = (await s.run(probePrimary, {limit: 2}))[index]; }
        if (!candidate) { emit(make(unit, 'primary-action', {steps: s.steps.slice(mark), observed: 'the action was not found again after reload', status: 'not_checked', reason: 'the first screen changed between loads'}, index)); continue; }
        const link = candidate.href !== null ? classifyLink(candidate.href, {origin: env.origin, routes: env.routes, files: env.files}) : null;
        if (link && (link.kind === 'contact' || link.kind === 'external' || link.kind === 'other')) {
          const wellFormed = link.kind !== 'contact' || (link.scheme === 'mailto' ? /@/.test(candidate.href) : candidate.href.replace(/\D/g, '').length >= 7);
          emit(make(unit, 'primary-action', {steps: [`read "${candidate.text}" → ${candidate.href} (listed, not followed)`], observed: `${candidate.desc} is a ${link.kind === 'contact' ? `${link.scheme}:` : 'external'} link (${candidate.href})`, status: wellFormed ? 'passed' : 'failed', reason: wellFormed ? undefined : `the ${link.scheme}: link has no usable address`}, index));
          continue;
        }
        await s.run(probeWatchStart);
        await wait(600);
        const baseline = (await s.run(probeWatchEnd, {anchor: null, clicked: null}))?.mutations ?? 0;
        await s.run(probeWatchStart);
        const violationsBefore = s.ledger.violations.length, urlBefore = s.page.url();
        await s.click(candidate.ref, `primary action "${candidate.text}"`);
        await wait(1000);
        let effect;
        try { effect = await s.run(probeWatchEnd, {anchor: link?.kind === 'anchor' ? link.anchor : null, clicked: candidate.ref}); } catch { effect = null; }
        if (!effect) effect = {mutations: 0, urlChanged: s.page.url() !== urlBefore, url: s.page.url(), dy: 0, newForm: false, dialog: false, focusMoved: null, anchorTarget: false};
        effect.waitedMs = 1000;
        if (s.page.url() !== urlBefore) { effect.urlChanged = true; effect.url = s.page.url(); }
        const decision = decidePrimary({link, effect, baselineMutations: baseline, violations: s.ledger.violations.slice(violationsBefore)});
        emit(make(unit, 'primary-action', {steps: s.steps.slice(mark), ...decision, evidence: {screenshot: decision.status === 'failed' ? await s.shot(`primary${unit.route}-${label(unit.viewport)}-${index}`) : null, log: [JSON.stringify({candidate: candidate.desc, href: candidate.href, baselineMutations: baseline, effect})]}}, index));
      }
    } finally { await s.close(); }
  },

  async forms(env, unit, {emit, expect, resolve}) {
    const s = await session(env, unit);
    try {
      const ready = await s.goto(unit.route);
      if (!ready.rootReady) { for (const check of unit.checks) emit(make(unit, check, {steps: s.steps, observed: 'the route did not render', status: 'not_checked', reason: 'the page never rendered'})); return; }
      const forms = (await s.run(probeForms)).slice(0, 3);
      resolve();
      forms.forEach((_, index) => { expect('form-empty-submit', index); expect('form-submit', index); });
      for (const [index, listed] of forms.entries()) {
        const mark = s.steps.length;
        let form = listed;
        if (index > 0) { await s.reload(unit.route); form = (await s.run(probeForms))[index]; if (!form) continue; }
        const regionArgs = {form: form.ref, region: form.regionRef};
        if (form.submitRef < 0) {
          for (const check of ['form-empty-submit', 'form-submit']) emit(make(unit, check, {steps: [`read ${form.desc}`], observed: 'the form has no visible submit button', status: 'failed', reason: 'the form cannot be submitted'}, index));
          continue;
        }
        const postsBefore = s.ledger.enquiries.length;
        await s.click(form.submitRef, `submit (empty) "${form.submitText}"`);
        await wait(700);
        const empty = await s.run(probeFormState, regionArgs);
        const emptyPosts = s.ledger.enquiries.slice(postsBefore);
        const emptyOk = (empty.invalid.length > 0 || empty.live.some(text => text.length > 3)) && !emptyPosts.length;
        emit(make(unit, 'form-empty-submit', {steps: s.steps.slice(mark), observed: emptyPosts.length ? `the empty form sent ${emptyPosts.length} POST(s)` : empty.invalid.length ? `invalid: ${empty.invalid.join(', ')}${empty.live.length ? `; message "${empty.live[0].slice(0, 80)}"` : ''}` : empty.live.length ? `message "${empty.live[0].slice(0, 80)}"` : 'no field reports invalid and no error appears', status: emptyOk ? 'passed' : 'failed', reason: emptyOk ? undefined : emptyPosts.length ? 'an empty form was sent' : 'an empty submit gives no feedback (no required fields, aria-invalid or error message)', evidence: {screenshot: emptyOk ? null : await s.shot(`form-empty${unit.route}-${index}`), log: []}}, index));
        if (/^mailto:/i.test(form.action)) { emit(make(unit, 'form-submit', {steps: [], ...decideForm({mailto: true})}, index)); continue; }
        const fillMark = s.steps.length;
        const fields = form.fields.filter(field => field.rendered && !field.honeypot && !['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(field.type));
        const radios = new Set();
        for (const field of fields) {
          const hint = `${field.name} ${field.label} ${field.autocomplete}`.toLowerCase();
          if (field.type === 'checkbox') { if (field.required) { env.budget.step(); s.steps.push(`check ${field.name || field.label}`); await s.run(probeSetValue, {ref: field.ref, check: true}); } continue; }
          if (field.type === 'radio') { if (!radios.has(field.name)) { radios.add(field.name); env.budget.step(); s.steps.push(`choose the first ${field.name} option`); await s.run(probeSetValue, {ref: field.ref, check: true}); } continue; }
          let value;
          if (field.tag === 'select') value = field.options?.[0];
          else if (field.type === 'email' || /e-?mail/.test(hint)) value = FICTIONAL.email;
          else if (field.type === 'tel' || /phone|\btel\b|mobile/.test(hint)) value = FICTIONAL.phone;
          else if (field.type === 'number') value = field.min && Number(field.min) > 2 ? field.min : '2';
          else if (field.type === 'date') value = field.min && field.min > '2027-03-15' ? field.min : '2027-03-15';
          else if (field.type === 'time') value = '12:00';
          else if (field.type === 'datetime-local') value = '2027-03-15T12:00';
          else if (field.type === 'url') value = 'https://example.invalid';
          else if (field.tag === 'textarea' || /message|enquiry|inquiry|details|notes|comment|question|tell us/.test(hint)) value = FICTIONAL.message;
          else value = FICTIONAL.name;
          if (value === undefined) continue;
          env.budget.step();
          s.steps.push(`fill ${field.name || field.label || field.type} with "${value}"`);
          if (['text', 'email', 'tel', 'search', 'url', 'textarea', 'password', 'number'].includes(field.type) || field.tag === 'textarea') {
            if (await s.run(probeFocusRef, {ref: field.ref})) { await s.page.keyboard.press('ControlOrMeta+A'); await s.page.keyboard.insertText(value); continue; }
          }
          await s.run(probeSetValue, {ref: field.ref, value});
        }
        const before = await s.run(probeFormState, regionArgs);
        const posts0 = s.ledger.enquiries.length, violations0 = s.ledger.violations.length, url0 = s.page.url();
        await s.click(form.submitRef, `submit (filled) "${form.submitText}"`);
        // Wait for the sink, then a little longer to catch a duplicate POST; a status message may follow the response.
        const end = Date.now() + 3500;
        while (Date.now() < end && s.ledger.enquiries.length === posts0 && s.ledger.violations.length === violations0) await wait(150);
        await wait(1500);
        const navigated = s.page.url() !== url0 ? s.page.url() : null;
        let after = null;
        try { after = await s.run(probeFormState, regionArgs); } catch { after = null; }
        const posts = s.ledger.enquiries.slice(posts0);
        const fresh = after ? [...after.live.filter(text => !before.live.includes(text)), ...after.blocks.filter(text => !before.blocks.includes(text) && !Object.values(FICTIONAL).some(value => text.includes(value)))] : [];
        const message = (fresh[0] ?? (after && after.live.find(text => text.length > 3 && !before.live.includes(text))) ?? '').slice(0, 160);
        const decision = decideForm({posts, violations: s.ledger.violations.slice(violations0), message, navigatedTo: navigated, invalidAfterFill: after?.connected && !posts.length ? after.invalid : [], origin: env.origin});
        emit(make(unit, 'form-submit', {steps: s.steps.slice(fillMark), ...decision, evidence: {screenshot: await s.shot(`form-submit${unit.route}-${index}`), log: [...posts.map(post => `POST /_mb/enquiries → ${post.status} ${JSON.stringify(post.body)}`), ...logOf(s.ledger).filter(line => line.startsWith('violation'))]}}, index));
      }
    } finally { await s.close(); }
  },

  async reduced(env, unit, {emit}) {
    const s = await session(env, unit, {reducedMotion: 'reduce'});
    try {
      const ready = await s.goto(unit.route);
      if (!ready.rootReady) { emit(make(unit, 'reduced-motion', {steps: s.steps, observed: 'the route did not render', status: 'not_checked', reason: 'the page never rendered'})); return; }
      const {max} = await s.run(probeScroll, {to: 'top'});
      env.budget.step();
      const stride = Math.max(200, Math.round(unit.viewport.height * 0.8));
      for (let y = stride, count = 0; y <= max + stride && count < 40; y += stride, count++) { await s.run(probeScroll, {to: Math.min(y, max)}); await wait(80); }
      await s.run(probeScroll, {to: 'top'});
      await wait(600);
      s.steps.push(`scroll through the page (${max} px) and back to the top, then inspect every text and media element (isolated world)`);
      const found = await s.run(probeReduced);
      const failed = found.hiddenCount > 0 || found.animationCount > 0;
      const problems = [
        ...(found.hiddenCount ? [`${found.hiddenCount} content element(s) stay hidden: ${found.hidden.slice(0, 4).map(item => `${item.desc} (${item.why})`).join('; ')}`] : []),
        ...(found.animationCount ? [`${found.animationCount} infinite animation(s) run: ${found.animations.slice(0, 3).map(item => `${item.name} on ${item.target}`).join('; ')}`] : []),
      ];
      emit(make(unit, 'reduced-motion', {steps: s.steps, observed: failed ? problems.join('; ') : `${found.considered} content element(s) visible; no infinite animation`, status: failed ? 'failed' : 'passed', reason: failed ? 'reduced-motion visitors miss content or still get looping motion' : undefined, evidence: {screenshot: failed ? await s.shot(`reduced${unit.route}-${label(unit.viewport)}`) : null, log: [...found.hidden.map(item => JSON.stringify(item)), ...found.animations.map(item => JSON.stringify(item))]}}));
    } finally { await s.close(); }
  },
};
