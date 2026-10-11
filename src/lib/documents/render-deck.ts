import type { Deck } from "./schema";
import { FONTS } from "./theme";
import { chartSvg, esc } from "./chart-svg";
import { composeSlide, H, W, type Prim, type SlideScene } from "./slide-scene";

export type ImageMap = Record<string, string | undefined>;
const pct = (value: number, total: number) => `${(value / total * 100).toFixed(4)}%`;
const box = (p: { x: number; y: number; w: number; h: number }) => `left:${pct(p.x, W)};top:${pct(p.y, H)};width:${pct(p.w, W)};height:${pct(p.h, H)}`;
const cq = (px: number) => `${(px / (W / 100)).toFixed(4)}cqw`;
const rgba = (hex: string, alpha: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alpha})`; };

function primHtml(prim: Prim, deck: Deck, images: ImageMap) {
  const fonts = FONTS[deck.theme.fonts];
  switch (prim.k) {
    case "rect": {
      const background = prim.fade === "up"
        ? `linear-gradient(to top,${rgba(prim.fill, prim.opacity ?? 1)} 0%,${rgba(prim.fill, (prim.opacity ?? 1) * 0.75)} 45%,${rgba(prim.fill, 0)} 100%)`
        : rgba(prim.fill, prim.opacity ?? 1);
      return `<div class="p" style="${box(prim)};background:${background}${prim.radius ? `;border-radius:${cq(prim.radius)}` : ""}"></div>`;
    }
    case "ellipse":
      return `<div class="p" style="${box(prim)};border-radius:50%;${prim.fill ? `background:${prim.fill};` : ""}${prim.stroke ? `border:${cq(prim.strokeWidth ?? 2)} solid ${prim.stroke};` : ""}opacity:${prim.opacity ?? 1}"></div>`;
    case "line":
      return `<svg class="p" style="left:0;top:0;width:100%;height:100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="${prim.x1}" y1="${prim.y1}" x2="${prim.x2}" y2="${prim.y2}" stroke="${prim.color}" stroke-width="${prim.width}" stroke-linecap="round" opacity="${prim.opacity ?? 1}"/></svg>`;
    case "image": {
      const src = images[prim.name];
      return src
        ? `<img class="p" style="${box(prim)};object-fit:cover" src="${esc(src)}" alt="${esc(prim.alt)}">`
        : `<div class="p ph" style="${box(prim)}"><span>${esc(prim.alt || prim.name)}</span></div>`;
    }
    case "chart":
      return `<div class="p" style="${box(prim)}">${chartSvg(prim.chart, prim.w, prim.h, prim.colors, { heading: fonts.heading, body: fonts.body })}</div>`;
    case "text": {
      const style = [box(prim), `font-family:${prim.font === "heading" ? "var(--heading)" : "var(--body)"}`, `font-size:${cq(prim.size)}`, `line-height:${prim.lh}`,
        `font-weight:${prim.weight}`, `color:${prim.color}`, `text-align:${prim.align}`, `justify-content:${prim.valign === "middle" ? "center" : prim.valign === "bottom" ? "flex-end" : "flex-start"}`,
        prim.tracking ? `letter-spacing:${prim.tracking}em` : prim.font === "heading" ? `letter-spacing:${fonts.headingTracking}` : "", prim.upper ? "text-transform:uppercase" : "", prim.italic ? "font-style:italic" : ""].filter(Boolean).join(";");
      return `<div class="p t${prim.role === "title" ? " title" : ""}" style="${style}">${esc(prim.text)}</div>`;
    }
  }
}

export function slideHtml(deck: Deck, scene: SlideScene, images: ImageMap, label: string) {
  return `<section class="slide" aria-label="${esc(label)}" style="background:${scene.background}">${scene.prims.map(prim => primHtml(prim, deck, images)).join("")}</section>`;
}

/** Complete standalone document. `print` lays out one 1280×720 page per slide
 * for Chromium's PDF printer; `preview` stacks responsive slides with notes. */
export function deckHtml(deck: Deck, images: ImageMap, mode: "preview" | "print" = "preview") {
  const fonts = FONTS[deck.theme.fonts];
  const total = deck.slides.length;
  const slides = deck.slides.map((slide, index) => {
    const html = slideHtml(deck, composeSlide(deck, slide, index, total), images, `Slide ${index + 1}: ${slide.title}`);
    if (mode === "print") return html;
    return `<figure class="frame" id="slide-${esc(slide.id)}"><figcaption><b>${String(index + 1).padStart(2, "0")}</b> ${esc(slide.layout)}</figcaption>${html}<details><summary>Speaker notes</summary><p>${esc(slide.notes)}</p></details></figure>`;
  }).join("");
  const empty = !total ? `<div class="empty">Slides appear here as they are written.</div>` : "";
  const css = `*{box-sizing:border-box}html,body{margin:0}body{--heading:${fonts.heading};--body:${fonts.body};font-family:var(--body);-webkit-font-smoothing:antialiased}
.slide{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;container-type:inline-size}
.p{position:absolute;margin:0}.t{display:flex;flex-direction:column;white-space:pre-wrap;overflow-wrap:break-word}
.ph{display:flex;align-items:center;justify-content:center;background:repeating-linear-gradient(135deg,rgba(127,127,127,.12) 0 12px,rgba(127,127,127,.04) 12px 24px);color:rgba(90,90,90,.9);font:600 1.1cqw/1.3 var(--body);text-align:center;padding:2cqw}
${mode === "print"
    ? `@page{size:${W}px ${H}px;margin:0}body{width:${W}px}.slide{width:${W}px;height:${H}px;break-after:page}.slide:last-child{break-after:auto}`
    : `body{background:#E9E8E4;padding:28px 24px 64px}.frame{max-width:1120px;margin:0 auto 34px}.frame .slide{border-radius:6px;box-shadow:0 1px 2px rgba(0,0,0,.08),0 12px 32px rgba(20,20,30,.12)}
figcaption{font:12px/1.4 system-ui,sans-serif;color:#6B6B6B;margin:0 0 8px;letter-spacing:.04em;text-transform:uppercase}figcaption b{color:#222;margin-right:6px}
details{font:13px/1.5 system-ui,sans-serif;color:#444;margin-top:8px}summary{cursor:pointer;color:#666}details p{margin:6px 0 0;white-space:pre-wrap;max-width:80ch}
.empty{max-width:1120px;margin:0 auto;aspect-ratio:16/9;border:2px dashed #C9C7C1;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#77756F;font:15px system-ui,sans-serif}`}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(deck.title)}</title><style>${css}</style></head><body>${slides}${empty}</body></html>`;
}
