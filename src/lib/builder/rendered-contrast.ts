/** Contrast in rendered states (audit NPD "measure contrast from rendered/composited
 * colours at actual size, including hover/focus/error"). The client-ready check only
 * compares colour pairs written in the same CSS rule; this measures what the browser
 * actually computes for the prepared pages: text colour over its composited
 * background at its real size and weight, in the default state and with the site's
 * own hover, focus and invalid-field rules applied, plus the border of invalid fields.
 *
 * How states are applied: every author rule using :hover, :focus, :focus-visible,
 * :focus-within, :active, :invalid or :user-invalid is copied right after itself
 * with that pseudo-class replaced by a [data-mb-state~=...] attribute (same
 * specificity, same order), and the attribute is set on one element at a time
 * (hover also on its ancestors). Nothing runs inside the page: the frame has no
 * scripts, and it is measured from outside.
 *
 * Limits (shown in the UI): one desktop width (1280 px); text over images or
 * gradients, opacity, text shadows, transitions, the browser's own default focus
 * ring and states set by the site's scripts aren't measured; colour the browser
 * can't express as sRGB is clipped. A clean result means "nothing found by these
 * measurements", not an accessibility certification. Pure helpers are tested
 * offline; measureRenderedContrast needs a real browser document. */

export type Rgba = [number, number, number, number];
export type ContrastState = "default" | "hover" | "focus" | "invalid";
export type ContrastFinding = {
  page: string; state: ContrastState; kind: "text" | "field-border";
  /** e.g. 'a “Book a table”' */
  element: string; ratio: number; required: number; foreground: string; background: string;
};
export type ContrastResult = { findings: ContrastFinding[]; measured: number; unmeasured: { image: number; color: number }; rewrittenRules: number };

const STATE_PSEUDO = /:(hover|focus-visible|focus-within|focus|active|user-invalid|invalid)(?![\w-])/g;
const STATE_OF: Record<string, string> = { hover: "hover", active: "hover", focus: "focus", "focus-visible": "focus", "focus-within": "focus-within", invalid: "invalid", "user-invalid": "invalid" };
/** The selector with state pseudo-classes replaced by attributes, or null when it has none. */
export function rewriteSelector(selector: string): string | null {
  if (!STATE_PSEUDO.test(selector)) return null;
  STATE_PSEUDO.lastIndex = 0;
  return selector.replace(STATE_PSEUDO, (_match, name: string) => `[data-mb-state~="${STATE_OF[name]}"]`);
}

const channel = (value: number) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]: Rgba) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export function contrast(a: Rgba, b: Rgba) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round((light + 0.05) / (dark + 0.05) * 100) / 100;
}
/** Source-over: `top` (with alpha) painted on an opaque `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
}
/** WCAG large text: at least 24 px, or 18.66 px (14 pt) and bold. */
export const largeText = (px: number, weight: number) => px >= 24 || (px >= 18.66 && weight >= 700);
export const requiredRatio = (px: number, weight: number) => largeText(px, weight) ? 3 : 4.5;
export const hex = ([r, g, b]: Rgba) => `#${[r, g, b].map(value => Math.round(value).toString(16).padStart(2, "0")).join("")}`;

/** Background layers from the element up; the first opaque one ends the walk (the canvas is white). */
export function compositeBackground(layers: readonly (Rgba | "image")[]): Rgba | "image" {
  const stack: Rgba[] = [];
  for (const layer of layers) {
    if (layer === "image") return "image";
    if (layer[3] <= 0) continue;
    stack.push(layer);
    if (layer[3] >= 1) break;
  }
  let color: Rgba = [255, 255, 255, 1];
  for (const layer of stack.reverse()) color = over(layer, color);
  return color;
}

/** One finding per page, state, element and colour pair (state findings only when they differ from default). */
export function summarizeFindings(findings: readonly ContrastFinding[]) {
  const seen = new Set<string>(), kept: ContrastFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.page}|${finding.state}|${finding.kind}|${finding.element}|${finding.foreground}|${finding.background}`;
    if (seen.has(key)) continue;
    seen.add(key); kept.push(finding);
  }
  return kept;
}

// ---------------------------------------------------------------- browser measurement

const INTERACTIVE = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])';
const FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
type Grouping = { cssRules: CSSRuleList; insertRule(rule: string, index?: number): number };

/** Copies state rules next to themselves with attribute selectors. Returns how many were added. */
function rewriteStateRules(doc: Document, view: Window) {
  let added = 0;
  const visit = (container: Grouping) => {
    let rules: CSSRule[];
    try { rules = [...container.cssRules]; } catch { return; }
    const inserts: [number, string][] = [];
    rules.forEach((rule, index) => {
      const style = rule as CSSStyleRule;
      if (typeof style.selectorText === "string") {
        const rewritten = rewriteSelector(style.selectorText);
        if (rewritten) inserts.push([index + 1, `${rewritten}{${style.style.cssText}}`]);
      }
      const media = rule as CSSMediaRule;
      // Hover media queries describe the device; the state is being simulated, so they apply.
      if (media.media !== undefined && typeof media.conditionText === "string" && !/hover/.test(media.conditionText) && !view.matchMedia(media.conditionText).matches) return;
      if ((rule as unknown as Grouping).cssRules?.length) visit(rule as unknown as Grouping);
    });
    for (const [index, text] of inserts.reverse()) { try { container.insertRule(text, index); added++; } catch { /* a selector this browser can't parse */ } }
  };
  for (const sheet of [...doc.styleSheets]) visit(sheet);
  return added;
}

/** Visible text of an element itself (not its children), shortened. */
const ownText = (element: Element) => [...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
const describe = (element: Element, text: string) => `${element.tagName.toLowerCase()}${text ? ` “${text.length > 40 ? `${text.slice(0, 39)}…` : text}”` : ""}`;

/**
 * Measures one rendered page. `parse` turns any computed CSS colour into sRGB bytes
 * (in a browser: paint it on a 1×1 canvas). The document must have no scripts.
 */
export function measureRenderedContrast(doc: Document, view: Window, page: string, parse: (color: string) => Rgba | null, limit = 150): ContrastResult {
  const freeze = doc.createElement("style");
  freeze.setAttribute("data-mb-measure", "");
  freeze.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
  doc.head.appendChild(freeze);
  const rewrittenRules = rewriteStateRules(doc, view);
  const findings: ContrastFinding[] = [], unmeasured = { image: 0, color: 0 };
  let measured = 0;
  const background = (element: Element): Rgba | "image" | null => {
    const layers: (Rgba | "image")[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = view.getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage !== "none") { layers.push("image"); break; }
      const color = parse(style.backgroundColor);
      if (!color) return null;
      layers.push(color);
      if (color[3] >= 1) break;
    }
    return compositeBackground(layers);
  };
  const measureText = (element: Element, state: ContrastState, baseline: Map<Element, string>) => {
    const style = view.getComputedStyle(element);
    const text = FIELDS.has(element.tagName) ? ((element as HTMLInputElement).value ?? "") : ownText(element);
    const box = element.getBoundingClientRect();
    // Not rendered, or visually hidden (screen-reader-only text is 1 px and clipped).
    if (!text || style.visibility === "hidden" || style.display === "none" || box.width <= 1 || box.height <= 1) return;
    const bg = background(element), fg = parse(style.color);
    if (bg === "image") { unmeasured.image++; return; }
    if (!bg || !fg) { unmeasured.color++; return; }
    const shown = over(fg, bg), pair = `${hex(shown)}|${hex(bg)}`;
    if (state === "default") baseline.set(element, pair);
    else if (baseline.get(element) === pair) return;
    measured++;
    const ratio = contrast(shown, bg), required = requiredRatio(parseFloat(style.fontSize) || 16, parseInt(style.fontWeight, 10) || 400);
    if (ratio < required) findings.push({ page, state, kind: "text", element: describe(element, text), ratio, required, foreground: hex(shown), background: hex(bg) });
  };
  const textTargets = (element: Element) => [element, ...[...element.querySelectorAll("*")].filter(child => ownText(child)).slice(0, 5)];
  const candidates = [...doc.querySelectorAll(INTERACTIVE)].filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; }).slice(0, limit);
  const baseline = new Map<Element, string>();
  // Default: every visible text element on the page (bounded), not only interactive ones.
  for (const element of [...doc.body.querySelectorAll("*")].filter(child => ownText(child)).slice(0, limit * 4)) measureText(element, "default", baseline);
  for (const element of candidates) for (const target of textTargets(element)) if (!baseline.has(target)) measureText(target, "default", baseline);
  const setState = (element: Element, state: string, on: boolean) => {
    const current = new Set((element.getAttribute("data-mb-state") ?? "").split(" ").filter(Boolean));
    if (on) current.add(state); else current.delete(state);
    if (current.size) element.setAttribute("data-mb-state", [...current].join(" ")); else element.removeAttribute("data-mb-state");
  };
  const ancestors = (element: Element) => { const list: Element[] = []; for (let node = element.parentElement; node; node = node.parentElement) list.push(node); return list; };
  for (const element of candidates) {
    for (const state of ["hover", "focus"] as const) {
      setState(element, state, true);
      const up = ancestors(element);
      for (const node of up) setState(node, state === "hover" ? "hover" : "focus-within", true);
      for (const target of textTargets(element)) measureText(target, state, baseline);
      setState(element, state, false);
      for (const node of up) setState(node, state === "hover" ? "hover" : "focus-within", false);
    }
    if (FIELDS.has(element.tagName)) {
      const before = element.getAttribute("aria-invalid");
      setState(element, "invalid", true); element.setAttribute("aria-invalid", "true");
      measureText(element, "invalid", baseline);
      const style = view.getComputedStyle(element), border = parse(style.borderTopColor), bg = element.parentElement ? background(element.parentElement) : null;
      if (border && bg && bg !== "image" && parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none") {
        measured++;
        const shown = over(border, bg), ratio = contrast(shown, bg);
        if (ratio < 3) findings.push({ page, state: "invalid", kind: "field-border", element: describe(element, (element as HTMLInputElement).name || (element as HTMLInputElement).placeholder || ""), ratio, required: 3, foreground: hex(shown), background: hex(bg) });
      }
      setState(element, "invalid", false);
      if (before === null) element.removeAttribute("aria-invalid"); else element.setAttribute("aria-invalid", before);
    }
  }
  freeze.remove();
  return { findings: summarizeFindings(findings), measured, unmeasured, rewrittenRules };
}

/** sRGB bytes for any CSS colour, painted on a 1×1 canvas of `doc` (cached). */
export function canvasColorParser(doc: Document) {
  const canvas = doc.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const cache = new Map<string, Rgba | null>();
  return (color: string): Rgba | null => {
    if (cache.has(color)) return cache.get(color)!;
    let result: Rgba | null = null;
    if (context && color) {
      if (/^(?:transparent|rgba?\(\s*0,\s*0,\s*0,\s*0\s*\))$/i.test(color.trim())) result = [0, 0, 0, 0];
      else {
        context.clearRect(0, 0, 1, 1);
        // An unparseable value leaves the sentinel in place: report it as unmeasured, never as a colour.
        context.fillStyle = "#010203";
        context.fillStyle = color;
        if (context.fillStyle !== "#010203" || /^#010203$/i.test(color.trim())) {
          context.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
          result = [r, g, b, a / 255];
        }
      }
    }
    cache.set(color, result);
    return result;
  };
}
