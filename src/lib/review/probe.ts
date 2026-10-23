/**
 * Rendered-page probes for the independent review, run inside an offline,
 * script-free headless browser on the exact revision under review. Plain DOM
 * code with no imports and no outer references: each exported function is
 * serialised into the page (page.evaluate), so it must be self-contained.
 *
 * coveredText follows feature/image-led-sites src/lib/builder/layout-probe.ts
 * (hit-testing each text line with elementsFromPoint, pointer-events forced
 * on); the overflow walk follows its pageOverflow. Ported, not imported: that
 * branch is not merged.
 */

export type ProbeReport = {
  width: number; pageHeight: number;
  overflow: { px: number; element: string; text: string } | null;
  covered: { text: string; element: string; by: string }[];
  clipped: { text: string; element: string; axis: "x" | "y" | "page"; px: number }[];
  failedImages: { src: string; element: string }[];
  missingAlt: { src: string; element: string }[];
  links: { href: string; text: string; element: string; dead: boolean; reason: string | null }[];
  unnamedFields: { element: string; type: string; name: string }[];
  formsWithoutSubmit: { element: string }[];
  text: string;
  sections: { key: string; selectorHint: string; text: string; html: string }[];
  brand: { variables: Record<string, string>; bodyFont: string; headingFont: string; logo: string | null; title: string };
  /** For the diff guard: which content sections hold elements matching each requested description. */
  targets?: { target: string; sections: string[] }[];
};

export function probeWebsite(args: { width: number; targets?: string[] }): ProbeReport {
  const doc = document, view = window, width = args.width;
  const describe = (el: Element) => {
    const cls = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls.length ? `.${cls.join(".")}` : ""}`;
  };
  const clean = (value: string | null | undefined, max = 80) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const hidden = (el: Element) => {
    const details = el.closest("details");
    if (details && !(details as HTMLDetailsElement).open && !el.closest("summary")) return true;
    for (let node: Element | null = el; node && node !== doc.body; node = node.parentElement) {
      const style = view.getComputedStyle(node), rect = node.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return true;
      if ((rect.width <= 1 || rect.height <= 1) && (style.overflow === "hidden" || style.clip !== "auto" || style.clipPath !== "none")) return true;
    }
    return false;
  };

  // ---- Covered text (paint order hit-testing) ----
  const covered: ProbeReport["covered"] = [];
  const paints = (el: Element) => {
    if (el.closest("img, picture, video, canvas, svg, iframe")) return true;
    const style = view.getComputedStyle(el);
    if (Number(style.opacity) < 0.3 || style.visibility === "hidden") return false;
    if (style.backgroundImage && style.backgroundImage !== "none") return true;
    const alpha = /rgba?\(([^)]+)\)/.exec(style.backgroundColor)?.[1]?.split(/[\s,/]+/).filter(Boolean)[3];
    return style.backgroundColor !== "transparent" && (alpha === undefined ? true : Number(alpha) >= 0.5);
  };
  const force = doc.createElement("style");
  force.textContent = "*, *::before, *::after { pointer-events: auto !important; }";
  doc.head.appendChild(force);
  try {
    const seen = new Set<string>(), done = new Set<Node>();
    const texts: { node: Node; owner: Element; text: string }[] = [];
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node && texts.length < 3000; node = walker.nextNode()) {
      const text = clean(node.textContent, 200), owner = node.parentElement;
      if (text.length < 2 || !owner || owner.closest("[aria-hidden='true'], script, style, noscript, svg, summary")) continue;
      if (view.getComputedStyle(owner).position === "fixed" || hidden(owner)) continue;
      texts.push({ node, owner, text });
    }
    // elementsFromPoint works in viewport coordinates: test the lines inside each screenful, one screen at a time (at most 16).
    const screens = Math.min(16, Math.ceil(doc.documentElement.scrollHeight / view.innerHeight));
    for (let screen = 0; screen < screens && covered.length < 12; screen++) {
      view.scrollTo(0, screen * view.innerHeight);
      for (const { node, owner, text } of texts) {
        if (done.has(node) || covered.length >= 12) continue;
        const range = doc.createRange(); range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects()).slice(0, 4).filter(rect => rect.width >= 4 && rect.height >= 4 && rect.right > 0 && rect.left < width);
        const visible = rects.filter(rect => rect.top + rect.height / 2 >= 0 && rect.top + rect.height / 2 < view.innerHeight);
        if (rects.length && rects.every(rect => rect.top + rect.height / 2 < view.innerHeight)) done.add(node);
        lines: for (const rect of visible) {
          const cy = rect.top + rect.height / 2;
          for (const at of [0.05, 0.5, 0.95]) {
            const x = Math.min(width - 1, Math.max(0, rect.left + rect.width * at));
            for (const hit of doc.elementsFromPoint(x, cy)) {
              if (hit === owner || owner.contains(hit)) break;
              if (hit.contains(owner) || !paints(hit)) continue;
              // A sticky header passing over content while scrolled is not a layout defect.
              let floating = false;
              for (let up: Element | null = hit; up && up !== doc.body; up = up.parentElement) if (/sticky|fixed/.test(view.getComputedStyle(up).position)) { floating = true; break; }
              if (floating && screen > 0) break;
              const key = `${text.slice(0, 40)}|${describe(hit)}`;
              if (!seen.has(key)) { seen.add(key); covered.push({ text: text.slice(0, 80), element: describe(owner), by: describe(hit) }); }
              done.add(node);
              break lines;
            }
          }
        }
      }
    }
  } finally { force.remove(); view.scrollTo(0, 0); }

  // ---- Page overflow and clipped text ----
  const rootClips = /hidden|clip/.test(view.getComputedStyle(doc.documentElement).overflowX) || /hidden|clip/.test(view.getComputedStyle(doc.body).overflowX);
  let overflow: ProbeReport["overflow"] = null;
  const clipped: ProbeReport["clipped"] = [];
  const all = Array.from(doc.body.querySelectorAll("*"));
  const clippedByAncestor = (el: Element) => {
    for (let node = el.parentElement; node && node !== doc.body; node = node.parentElement) if (/hidden|clip|auto|scroll/.test(view.getComputedStyle(node).overflowX)) return true;
    return false;
  };
  const scrollPx = Math.round(doc.documentElement.scrollWidth - width);
  let worst: Element | null = null, reach = width + 1;
  for (const el of all) {
    const rect = el.getBoundingClientRect(), style = view.getComputedStyle(el);
    if (rect.width <= 0 || style.position === "fixed" || clippedByAncestor(el)) continue;
    const right = Math.max(rect.right, rect.left + (style.overflowX === "visible" ? el.scrollWidth : 0));
    if (right > reach + 1 || (worst && worst.contains(el) && right >= reach - 1)) { worst = el; reach = Math.max(reach, right); }
  }
  if (scrollPx > 1) overflow = { px: scrollPx, element: worst ? describe(worst) : "the page", text: clean(worst?.textContent, 60) };
  else if (rootClips && worst && reach > width + 1 && clean(worst.textContent).length > 1)
    clipped.push({ text: clean(worst.textContent, 80), element: describe(worst), axis: "page", px: Math.round(reach - width) });
  for (const el of all) {
    if (clipped.length >= 12) break;
    const style = view.getComputedStyle(el);
    const clipsX = /hidden|clip/.test(style.overflowX), clipsY = /hidden|clip/.test(style.overflowY);
    if (!clipsX && !clipsY) continue;
    const text = clean(el.textContent, 120);
    if (text.length < 2 || hidden(el) || style.textOverflow === "ellipsis" || (style.webkitLineClamp && style.webkitLineClamp !== "none")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) continue;
    // Decorative crops (images, media) are fine; text cut off by its own box is not.
    if (!Array.from(el.querySelectorAll("*")).concat([el]).some(node => Array.from(node.childNodes).some(child => child.nodeType === 3 && clean(child.textContent).length > 1))) continue;
    const dx = el.scrollWidth - el.clientWidth, dy = el.scrollHeight - el.clientHeight;
    if (clipsX && dx > 2) clipped.push({ text, element: describe(el), axis: "x", px: dx });
    else if (clipsY && dy > 2) clipped.push({ text, element: describe(el), axis: "y", px: dy });
  }

  // ---- Images ----
  const failedImages: ProbeReport["failedImages"] = [], missingAlt: ProbeReport["missingAlt"] = [];
  for (const img of Array.from(doc.images)) {
    const src = img.getAttribute("src") ?? "";
    if (!src.trim() || (img.complete && img.naturalWidth === 0)) failedImages.push({ src: src.slice(0, 200), element: describe(img) });
    if (!img.hasAttribute("alt") && img.getAttribute("aria-hidden") !== "true") missingAlt.push({ src: src.slice(0, 200), element: describe(img) });
  }

  // ---- Links ----
  const links: ProbeReport["links"] = [];
  for (const a of Array.from(doc.querySelectorAll("a"))) {
    if (links.length >= 200) break;
    const href = (a.getAttribute("href") ?? "").trim();
    let dead = false, reason: string | null = null;
    if (!a.hasAttribute("href")) { dead = true; reason = "no href"; }
    else if (href === "" || href === "#") { dead = true; reason = "placeholder href"; }
    else if (/^javascript:/i.test(href)) { dead = true; reason = "script link"; }
    else if (/^#[^/]/.test(href)) {
      const id = decodeURIComponent(href.slice(1));
      if (!doc.getElementById(id) && !doc.getElementsByName(id).length) { dead = true; reason = `no element with id "${id.slice(0, 60)}"`; }
    }
    links.push({ href: href.slice(0, 200), text: clean(a.textContent || a.getAttribute("aria-label"), 60), element: describe(a), dead, reason });
  }

  // ---- Forms ----
  const unnamedFields: ProbeReport["unnamedFields"] = [], formsWithoutSubmit: ProbeReport["formsWithoutSubmit"] = [];
  for (const field of Array.from(doc.querySelectorAll("input, select, textarea"))) {
    const type = (field.getAttribute("type") ?? field.tagName.toLowerCase()).toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(type) || hidden(field)) continue;
    const labelled = (field as HTMLInputElement).labels?.length || clean(field.getAttribute("aria-label")).length > 0 || clean(field.getAttribute("title")).length > 0
      || (field.getAttribute("aria-labelledby") ?? "").split(/\s+/).some(id => id && clean(doc.getElementById(id)?.textContent).length > 0);
    if (!labelled) unnamedFields.push({ element: describe(field), type, name: clean(field.getAttribute("name"), 40) });
  }
  for (const form of Array.from(doc.forms)) {
    const submit = form.querySelector("button:not([type]), button[type='submit'], input[type='submit'], input[type='image']");
    if (!submit) formsWithoutSubmit.push({ element: describe(form) });
  }

  // ---- Content map (diff guard) and brand identity ----
  const sections: ProbeReport["sections"] = [];
  const blocks = Array.from(doc.querySelectorAll("body > header, body > nav, body > section, body > footer, body > div > header, body > div > section, body > div > footer, main > *, body > main > *"));
  const unique = blocks.filter((el, index) => blocks.indexOf(el) === index && !blocks.some(other => other !== el && other.contains(el)));
  unique.slice(0, 40).forEach((el, index) => sections.push({ key: el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}:${index}`, selectorHint: describe(el), text: clean(el.textContent, 4000), html: el.outerHTML.slice(0, 60_000) }));
  const targets = (args.targets ?? []).slice(0, 40).map(target => ({ target, sections: unique.slice(0, 40).flatMap((el, index) =>
    describe(el) === target || Array.from(el.querySelectorAll("*")).some(node => describe(node) === target) ? [el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}:${index}`] : []) }));
  const variables: Record<string, string> = {};
  const rootStyle = view.getComputedStyle(doc.documentElement);
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule) || !/(^|,)\s*:root\s*($|,)/.test(rule.selectorText)) continue;
      for (const name of Array.from(rule.style)) if (name.startsWith("--")) variables[name] = rootStyle.getPropertyValue(name).trim();
    }
  }
  const heading = doc.querySelector("h1, h2");
  const logo = doc.querySelector("header img, [class*='logo'] img, img[class*='logo'], img[alt*='logo' i]");
  return {
    width, pageHeight: Math.round(doc.documentElement.scrollHeight), overflow, covered, clipped, failedImages, missingAlt, links, unnamedFields, formsWithoutSubmit,
    text: (doc.body.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 20_000), sections,
    brand: { variables, bodyFont: view.getComputedStyle(doc.body).fontFamily, headingFont: heading ? view.getComputedStyle(heading).fontFamily : "", logo: logo?.getAttribute("src") ?? null, title: doc.title },
    targets,
  };
}

export type SlideProbe = { slide: number; text: string; clipped: { text: string; px: number; axis: "box" | "slide" }[] };
/** Deck slides (render-deck print mode): text that overflows its frame or runs past the slide edge. */
export function probeSlides(): SlideProbe[] {
  const clean = (value: string | null | undefined, max = 120) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return Array.from(document.querySelectorAll("section.slide")).map((slide, index) => {
    const frame = slide.getBoundingClientRect();
    const clipped: SlideProbe["clipped"] = [];
    for (const el of Array.from(slide.querySelectorAll(".t"))) {
      const text = clean(el.textContent);
      if (text.length < 2) continue;
      const rect = el.getBoundingClientRect();
      const dy = el.scrollHeight - el.clientHeight, dx = el.scrollWidth - el.clientWidth;
      if (dy > 3 || dx > 3) clipped.push({ text, px: Math.max(dx, dy), axis: "box" });
      else if (rect.right > frame.right + 2 || rect.bottom > frame.bottom + 2 || rect.left < frame.left - 2 || rect.top < frame.top - 2)
        clipped.push({ text, px: Math.round(Math.max(rect.right - frame.right, rect.bottom - frame.bottom, frame.left - rect.left, frame.top - rect.top)), axis: "slide" });
    }
    return { slide: index + 1, text: clean((slide as HTMLElement).innerText, 4000), clipped };
  });
}
