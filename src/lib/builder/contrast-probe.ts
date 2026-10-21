/**
 * In-browser half of the rendered-contrast finish gate. Bundled by
 * scripts/prepare-builder-runtime.mjs into public/builder-runtime/contrast-probe.js
 * (window.__makeborneContrast) and run by the server in a headless browser on
 * the app's own origin (contrast-gate.ts): it prepares the site exactly as
 * publishing does (captureStaticSnapshot), then measures the prepared page in a
 * script-free frame with the studio's own rendered-contrast check, at desktop
 * and phone widths. Nothing leaves the page; images are not loaded (text over
 * images is reported as unmeasured, as in the studio check).
 */
import { captureStaticSnapshot } from "./browser-bundler";
import { canvasColorParser, measureRenderedContrast, summarizeFindings, type ContrastFinding } from "./rendered-contrast";
import { previewDocument } from "../hosting/prepared-preview";

export type CoveredText = { text: string; element: string; by: string; width: number };
const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${typeof (el as HTMLElement).className === "string" && (el as HTMLElement).className.trim() ? `.${(el as HTMLElement).className.trim().split(/\s+/).slice(0, 2).join(".")}` : ""}`;
/** Visible text that another element is painted over (a card over the phone number, a sticky bar over a heading):
 * the centre of each text line is hit-tested; a hit outside the text's own subtree means it is covered. */
export function coveredText(doc: Document, view: Window, width: number, limit = 8): CoveredText[] {
  const out: CoveredText[] = [], seen = new Set<string>();
  /** Visually hidden on purpose: an .sr-only clip, a 1 px box, or inside a closed <details> (menu, accordion, FAQ). */
  const hidden = (el: Element) => {
    const details = el.closest("details");
    if (details && !(details as HTMLDetailsElement).open && !el.closest("summary")) return true;
    for (let node: Element | null = el; node && node !== doc.body; node = node.parentElement) {
      const style = view.getComputedStyle(node), box = node.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return true;
      if ((box.width <= 1 || box.height <= 1) && (style.overflow === "hidden" || style.clip !== "auto" || style.clipPath !== "none")) return true;
      if (style.clip !== "auto" && /rect\(0(px)?,? 0(px)?/.test(style.clip)) return true;
    }
    return false;
  };
  /** An element that actually paints over text: an opaque-ish background, a background image, or replaced/graphic content. */
  const paints = (el: Element) => {
    if (el.closest("img, picture, video, canvas, svg, iframe")) return true;
    const style = view.getComputedStyle(el);
    if (style.backgroundImage && style.backgroundImage !== "none") return true;
    const alpha = /rgba?\(([^)]+)\)/.exec(style.backgroundColor)?.[1]?.split(/[\s,/]+/).filter(Boolean)[3];
    return style.backgroundColor !== "transparent" && (alpha === undefined ? true : Number(alpha) >= 0.5);
  };
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && out.length < limit; node = walker.nextNode()) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    const owner = node.parentElement;
    if (text.length < 2 || !owner || owner.closest("[aria-hidden='true'], script, style, noscript, svg, summary")) continue;
    if (view.getComputedStyle(owner).position === "fixed" || hidden(owner)) continue;
    const range = doc.createRange(); range.selectNodeContents(node);
    lines: for (const rect of Array.from(range.getClientRects()).slice(0, 3)) {
      if (rect.width < 4 || rect.height < 4 || rect.right <= 0 || rect.left >= width) continue;
      // The middle of the line and, for text with descenders, the descender band: a highlight block
      // behind the next line of a tightly led headline paints over this line's g, p and y.
      const bands = /[gjpqy]/.test(text) ? [0.5, 0.86] : [0.5];
      for (const [x, y] of bands.flatMap(at => [rect.left + 3, rect.left + rect.width / 2, rect.right - 3].map(x => [x, rect.top + rect.height * at] as const))) {
        const hit = doc.elementFromPoint(x, y);
        if (!hit || hit === owner || owner.contains(hit) || hit.contains(owner) || !paints(hit)) continue;
        const key = `${text.slice(0, 40)}|${describe(hit)}`;
        if (seen.has(key)) continue;
        seen.add(key); out.push({ text: text.slice(0, 60), element: describe(owner), by: describe(hit), width });
        break lines;
      }
    }
  }
  return out;
}

export type CutOff = { text: string; element: string; side: "left" | "right"; width: number };
/** A card, panel or product mock with text that runs past the edge of the screen (reviews sent back a hero
 * card running off the page). Full-bleed bands (exactly the viewport wide), images, scrollers, marquees and
 * rotated bands are left alone: only boxed, painted elements holding text are reported, outermost first. */
export function cutOffPanels(doc: Document, view: Window, width: number, limit = 3): CutOff[] {
  const out: CutOff[] = [], reported: Element[] = [];
  const boxed = (style: CSSStyleDeclaration) => {
    const alpha = /rgba?\(([^)]+)\)/.exec(style.backgroundColor)?.[1]?.split(/[\s,/]+/).filter(Boolean)[3];
    const filled = style.backgroundColor !== "transparent" && (alpha === undefined || Number(alpha) >= 0.5);
    return filled || (["Top", "Right", "Bottom", "Left"] as const).some(side => parseFloat(style[`border${side}Width`]) >= 1 && style[`border${side}Style`] !== "none");
  };
  const exempt = (el: Element) => {
    for (let node: Element | null = el; node && node !== doc.body; node = node.parentElement) {
      const style = view.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || style.position === "fixed") return true;
      if (/auto|scroll/.test(style.overflowX) || (style.animationName && style.animationName !== "none")) return true;
      const matrix = /matrix\(([^)]+)\)/.exec(style.transform)?.[1]?.split(",").map(Number);
      if (matrix && (Math.abs(matrix[1]) > 0.01 || Math.abs(matrix[2]) > 0.01)) return true;
      if (node.getAttribute("aria-hidden") === "true" || node.closest("details:not([open])") && !node.closest("summary")) return true;
    }
    return false;
  };
  for (const el of Array.from(doc.body.querySelectorAll("div, section, article, aside, figure, li, table, form, blockquote, dl, ol, ul"))) {
    if (out.length >= limit) break;
    const rect = el.getBoundingClientRect();
    const side = rect.right > width + 2 ? "right" : rect.left < -2 ? "left" : null;
    if (!side || rect.width < 120 || rect.height < 40 || Math.abs(rect.width - width) <= 2 || rect.width > width * 1.5) continue;
    if (reported.some(parent => parent.contains(el))) continue;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length < 2 || !boxed(view.getComputedStyle(el)) || exempt(el)) continue;
    reported.push(el); out.push({ text: text.slice(0, 60), element: describe(el), side, width });
  }
  return out;
}

function measure(html: string, width: number, parse: ReturnType<typeof canvasColorParser>) {
  return new Promise<ReturnType<typeof measureRenderedContrast> & { covered: CoveredText[]; cutOff: CutOff[] }>((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:900px;border:0`;
    const timer = window.setTimeout(() => { frame.remove(); reject(new Error("timeout")); }, 15_000);
    frame.addEventListener("load", () => {
      try {
        const doc = frame.contentDocument, view = frame.contentWindow;
        if (!doc || !view) throw new Error("unavailable");
        const contrast = measureRenderedContrast(doc, view, "/", parse, 400);
        // The whole page in one viewport, so every line can be hit-tested.
        frame.style.height = `${Math.min(20_000, doc.documentElement.scrollHeight)}px`;
        resolve({ ...contrast, covered: coveredText(doc, view, width), cutOff: cutOffPanels(doc, view, width) });
      } catch (error) { reject(error); }
      finally { window.clearTimeout(timer); frame.remove(); }
    }, { once: true });
    frame.srcdoc = previewDocument(html);
    document.body.appendChild(frame);
  });
}

export async function probeContrast(files: Record<string, string>): Promise<{ findings: ContrastFinding[]; measured: number; unmeasuredImage: number; covered: CoveredText[]; cutOff: CutOff[] }> {
  const html = await captureStaticSnapshot(files, {});
  const parse = canvasColorParser(document);
  const findings: ContrastFinding[] = [];
  let measured = 0, unmeasuredImage = 0;
  const covered: CoveredText[] = [], cutOff: CutOff[] = [];
  for (const width of [1440, 390]) {
    const result = await measure(html, width, parse);
    findings.push(...result.findings); measured += result.measured; unmeasuredImage += result.unmeasured.image; covered.push(...result.covered); cutOff.push(...result.cutOff);
  }
  return { findings: summarizeFindings(findings), measured, unmeasuredImage, covered, cutOff };
}

declare global { interface Window { __makeborneContrast?: { probeContrast: typeof probeContrast } } }
if (typeof window !== "undefined") window.__makeborneContrast = { probeContrast };
