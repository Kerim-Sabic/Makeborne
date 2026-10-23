/**
 * Rendered layout checks of the finish gate (run by contrast-probe.ts in the headless browser on the prepared,
 * script-free page): text another element is painted over, panels cut off at the screen edge, and marquee or tag
 * bands that wrap into a second row. Plain DOM code with no imports, so offline checks can bundle it alone.
 */

export type CoveredText = { text: string; element: string; by: string; width: number };
export type CutOff = { text: string; element: string; side: "left" | "right"; width: number };
export type WrappedBand = { text: string; element: string; rows: number; width: number };

const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${typeof (el as HTMLElement).className === "string" && (el as HTMLElement).className.trim() ? `.${(el as HTMLElement).className.trim().split(/\s+/).slice(0, 2).join(".")}` : ""}`;

/**
 * Visible text that another element is painted over (a card over the phone number, a cut-out image laid over the
 * end of a line, a sticky bar over a heading). Each text line is sampled at five points along its middle (and its
 * descender band); at each point the elements are read in paint order, top first, with pointer-events forced on
 * (a decorative image with pointer-events: none still covers what is under it). The text is covered when an element
 * that paints (an image, a background, a filled box) outside the text's own subtree lies above it. Text set on a
 * panel or scrim above an image is on top, so it passes; text clipped on purpose (an ellipsis) is not sampled past
 * its own box.
 */
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
    if (Number(style.opacity) < 0.3 || style.visibility === "hidden") return false;
    if (style.backgroundImage && style.backgroundImage !== "none") return true;
    const alpha = /rgba?\(([^)]+)\)/.exec(style.backgroundColor)?.[1]?.split(/[\s,/]+/).filter(Boolean)[3];
    return style.backgroundColor !== "transparent" && (alpha === undefined ? true : Number(alpha) >= 0.5);
  };
  // Hit-testing sees what is painted, including elements that ignore the pointer.
  const force = doc.createElement("style");
  force.textContent = "*, *::before, *::after { pointer-events: auto !important; }";
  doc.head.appendChild(force);
  try {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node && out.length < limit; node = walker.nextNode()) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      const owner = node.parentElement;
      if (text.length < 2 || !owner || owner.closest("[aria-hidden='true'], script, style, noscript, svg, summary")) continue;
      if (view.getComputedStyle(owner).position === "fixed" || hidden(owner)) continue;
      // An ellipsis or a clipping box ends the visible line: never sample past the nearest box that clips it.
      let clipper: Element | null = owner;
      while (clipper && clipper !== doc.body && view.getComputedStyle(clipper).overflowX === "visible") clipper = clipper.parentElement;
      const own = clipper && clipper !== doc.body ? clipper.getBoundingClientRect() : { left: -Infinity, right: Infinity };
      const range = doc.createRange(); range.selectNodeContents(node);
      lines: for (const rect of Array.from(range.getClientRects()).slice(0, 4)) {
        const left = Math.max(rect.left, own.left), right = Math.min(rect.right, own.right);
        if (right - left < 4 || rect.height < 4 || right <= 0 || left >= width) continue;
        const bands = /[gjpqy]/.test(text) ? [0.5, 0.86] : [0.5];
        const xs = [0.02, 0.25, 0.5, 0.75, 0.98].map(at => Math.min(right - 2, Math.max(left + 2, left + (right - left) * at)));
        for (const [x, y] of bands.flatMap(at => xs.map(px => [px, rect.top + rect.height * at] as const))) {
          if (x < 0 || x >= width) continue;
          for (const hit of doc.elementsFromPoint(x, y)) {
            if (hit === owner || owner.contains(hit)) break; // the text is on top here
            if (hit.contains(owner) || !paints(hit)) continue;
            const key = `${text.slice(0, 40)}|${describe(hit)}`;
            if (!seen.has(key)) { seen.add(key); out.push({ text: text.slice(0, 60), element: describe(owner), by: describe(hit), width }); }
            break lines;
          }
        }
      }
    }
  } finally { force.remove(); }
  return out;
}

/** A card, panel or product mock with text that runs past the edge of the screen (reviews sent back a hero
 * card running off the page). Full-bleed bands (exactly the viewport wide), images, scrollers, marquees and
 * rotated bands are left alone: only boxed, painted elements holding text are reported, outermost first. */
export function cutOffPanels(doc: Document, view: Window, width: number, limit = 3, phone = false): CutOff[] {
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
      // Inside a closed <details> (a menu's links) is hidden; the closed <details> and its summary are on screen.
      if (node.getAttribute("aria-hidden") === "true" || node.parentElement?.closest("details:not([open])") && !node.closest("summary")) return true;
    }
    return false;
  };
  // On the narrowest phone (360 px) anything holding text past the edge is cut off or makes the page scroll sideways
  // (4 of 20 app-round sites: a header button, a menu, a sign-up panel), boxed or not.
  const selector = phone ? "div, section, article, aside, figure, li, table, form, blockquote, dl, ol, ul, a, button, details, nav, label, input, select, textarea" : "div, section, article, aside, figure, li, table, form, blockquote, dl, ol, ul";
  for (const el of Array.from(doc.body.querySelectorAll(selector))) {
    if (out.length >= limit) break;
    const rect = el.getBoundingClientRect();
    // Only an element that straddles the edge is cut off; one wholly off screen (a skip link before focus) is parked on purpose.
    const side = rect.right > width + 2 && rect.left < width - 2 ? "right" : rect.left < -2 && rect.right > 2 ? "left" : null;
    if (!side || rect.width < (phone ? 24 : 120) || rect.height < (phone ? 16 : 40) || Math.abs(rect.width - width) <= 2 || rect.width > width * 1.5) continue;
    if (reported.some(parent => parent.contains(el))) continue;
    if (phone && el.closest(".sr-only, [class*='visually-hidden']")) continue;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim() || (el as HTMLInputElement).placeholder || el.getAttribute("aria-label") || "";
    if (text.length < 2 || (!phone && !boxed(view.getComputedStyle(el))) || exempt(el)) continue;
    reported.push(el); out.push({ text: text.slice(0, 60), element: describe(el), side, width });
  }
  return out;
}

/** Class names of moving bands of words (marquee, ticker, tag or logo strips). */
export const BAND_CLASS = /marquee|ticker|scroller|tagline-band|tag-band|band-track|ribbon-track/i;
/**
 * Marquee and tag bands must be one row (an orphan word alone on a second line reads as broken): a band is an
 * element with a band class name or a running horizontal animation whose visible items (three or more) sit in more
 * than one row.
 */
export function wrappedBands(doc: Document, view: Window, width: number, limit = 2): WrappedBand[] {
  const out: WrappedBand[] = [];
  const candidates = new Set<Element>();
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    const name = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : "";
    const style = view.getComputedStyle(el);
    if (BAND_CLASS.test(name) || (style.animationName && style.animationName !== "none" && /translate|matrix/.test(style.transform + style.animationName) && el.children.length >= 3)) candidates.add(el);
  }
  for (const el of candidates) {
    if (out.length >= limit) break;
    // The track is the band itself or its item list: the deepest candidate level that holds the items.
    const items = Array.from(el.children).filter(child => {
      const style = view.getComputedStyle(child), box = child.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0 && (child.textContent ?? "").trim().length > 0;
    });
    if (items.length < 3) continue;
    const tops: number[] = [];
    for (const item of items) {
      const top = item.getBoundingClientRect().top;
      if (!tops.some(seen => Math.abs(seen - top) < 4)) tops.push(top);
    }
    if (tops.length > 1 && ![...out].some(found => found.element === describe(el))) {
      if (Array.from(candidates).some(other => other !== el && other.contains(el) && out.some(found => found.element === describe(other)))) continue;
      out.push({ text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60), element: describe(el), rows: tops.length, width });
    }
  }
  return out;
}
