import type { Deck } from "./schema";
import { FONTS } from "./theme";
import { chartSvg, esc } from "./chart-svg";
import { fontFaceCss, type FaceId, type FontSources } from "./fonts";
import { composeSlide, H, W, type ImageTreatment, type PathSeg, type Prim, type SlideScene } from "./slide-scene";
import { directionOf, type MotionKind } from "./directions";

export type ImageMap = Record<string, string | undefined>;
export type DeckMode = "preview" | "print" | "present";
const pct = (value: number, total: number) => `${(value / total * 100).toFixed(4)}%`;
const box = (p: { x: number; y: number; w: number; h: number }) => `left:${pct(p.x, W)};top:${pct(p.y, H)};width:${pct(p.w, W)};height:${pct(p.h, H)}`;
const cq = (px: number) => `${(px / (W / 100)).toFixed(4)}cqw`;
const rgba = (hex: string, alpha: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alpha})`; };
const num = (value: number) => Number(value.toFixed(2));
export const MONO_STACK = '"JetBrains Mono", Consolas, "Courier New", monospace';

/** Faces a deck's HTML needs: its pairing plus any its art direction adds (mono labels). */
export const deckFaces = (deck: Pick<Deck, "theme">): FaceId[] => [...new Set([...FONTS[deck.theme.fonts].faces, ...directionOf(deck.theme).faces])];

export function pathData(d: PathSeg[]) {
  return d.map(seg => seg.op === "Z" ? "Z" : seg.op === "C" ? `C${num(seg.x1)} ${num(seg.y1)} ${num(seg.x2)} ${num(seg.y2)} ${num(seg.x)} ${num(seg.y)}` : `${seg.op}${num(seg.x)} ${num(seg.y)}`).join("");
}
/** Luminance → two-colour ramp as an SVG colour matrix (the PPTX writer applies the same mapping to the pixels). */
export function treatmentMatrix(t: ImageTreatment) {
  const c = (hex: string) => [0, 8, 16].map(shift => (parseInt(hex.slice(1), 16) >> (16 - shift) & 255) / 255);
  const d = c(t.dark), l = c(t.light);
  return [0, 1, 2].map(i => `${(l[i] - d[i]) * 0.2126} ${(l[i] - d[i]) * 0.7152} ${(l[i] - d[i]) * 0.0722} 0 ${d[i]}`).join(" ") + " 0 0 0 1 0";
}
const filterId = (t: ImageTreatment) => `tr-${t.kind}-${t.dark.slice(1)}-${t.light.slice(1)}`;

/** Present mode staggers each primitive's entrance; other modes emit no motion markup. */
function primHtml(prim: Prim, deck: Deck, images: ImageMap, order?: number) {
  const fonts = FONTS[deck.theme.fonts];
  const motion = order === undefined ? "" : `;--i:${Math.min(order, 28)}`;
  const kind = order === undefined ? "" : prim.k === "text" ? (prim.role === "title" ? " m-title" : " m-text") : prim.k === "line" ? " m-line" : prim.k === "art" ? " m-art" : prim.k === "image" ? " m-img" : prim.k === "chart" ? " m-chart" : " m-shape";
  switch (prim.k) {
    case "rect": {
      const background = prim.noFill ? "transparent" : prim.fade === "up"
        ? `linear-gradient(to top,${rgba(prim.fill, prim.opacity ?? 1)} 0%,${rgba(prim.fill, (prim.opacity ?? 1) * 0.75)} 45%,${rgba(prim.fill, 0)} 100%)`
        : rgba(prim.fill, prim.opacity ?? 1);
      return `<div class="p${kind}" style="${box(prim)};background:${background}${prim.radius ? `;border-radius:${cq(prim.radius)}` : ""}${prim.stroke ? `;border:${cq(prim.strokeWidth ?? 1)} solid ${prim.stroke}` : ""}${motion}"></div>`;
    }
    case "ellipse":
      return `<div class="p${kind}" style="${box(prim)};border-radius:50%;${prim.fill ? `background:${prim.fill};` : ""}${prim.stroke ? `border:${cq(prim.strokeWidth ?? 2)} solid ${prim.stroke};` : ""}opacity:${prim.opacity ?? 1}${motion}"></div>`;
    case "line":
      return `<svg class="p${kind}" style="left:0;top:0;width:100%;height:100%${motion}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="${num(prim.x1)}" y1="${num(prim.y1)}" x2="${num(prim.x2)}" y2="${num(prim.y2)}" stroke="${prim.color}" stroke-width="${prim.width}" stroke-linecap="${prim.width >= 3 ? "butt" : "round"}" opacity="${prim.opacity ?? 1}" pathLength="1"${prim.dash ? ' stroke-dasharray="0.01 0.01"' : ""}/></svg>`;
    case "path":
      return `<svg class="p${kind}" style="${box(prim)};overflow:visible${motion}" viewBox="${num(prim.x)} ${num(prim.y)} ${num(prim.w)} ${num(prim.h)}" preserveAspectRatio="none" aria-hidden="true"><path d="${pathData(prim.d)}" fill="${prim.fill ?? "none"}"${prim.stroke ? ` stroke="${prim.stroke}" stroke-width="${prim.strokeWidth ?? 1}" stroke-linejoin="round"` : ""} opacity="${prim.opacity ?? 1}" pathLength="1"/></svg>`;
    case "art":
      return `<svg class="p${kind}" style="${box(prim)}${prim.opacity !== undefined ? `;opacity:${prim.opacity}` : ""}${motion}" viewBox="0 0 ${num(prim.w)} ${num(prim.h)}" preserveAspectRatio="none" aria-hidden="true">${prim.svg}</svg>`;
    case "image": {
      const src = images[prim.name];
      const shape = prim.round ? ";border-radius:50%" : prim.mask === "arch" ? `;border-radius:${cq(prim.w / 2)} ${cq(prim.w / 2)} 0 0` : "";
      const filter = prim.treatment ? `;filter:url(#${filterId(prim.treatment)})` : "";
      return src
        ? `<img class="p${kind}" style="${box(prim)};object-fit:cover${shape}${filter}${motion}" src="${esc(src)}" alt="${esc(prim.alt)}">`
        : `<div class="p ph${kind}" style="${box(prim)}${shape}${motion}"><span>${esc(prim.alt || prim.name)}</span></div>`;
    }
    case "chart":
      return `<div class="p${kind}" style="${box(prim)}${motion}">${chartSvg(prim.chart, prim.w, prim.h, prim.colors, { heading: fonts.heading, body: prim.style?.mono ? MONO_STACK : fonts.body }, prim.style)}</div>`;
    case "text": {
      const family = prim.font === "heading" ? "var(--heading)" : prim.font === "mono" ? "var(--mono)" : "var(--body)";
      const style = [box(prim), `font-family:${family}`, `font-size:${cq(prim.size)}`, `line-height:${prim.lh}`,
        `font-weight:${prim.weight}`, `color:${prim.color}`, `text-align:${prim.align}`, `justify-content:${prim.valign === "middle" ? "center" : prim.valign === "bottom" ? "flex-end" : "flex-start"}`,
        prim.tracking !== undefined ? `letter-spacing:${prim.tracking}em` : prim.font === "heading" ? `letter-spacing:${fonts.headingTracking}` : "",
        prim.font === "heading" && fonts.headingStretch ? `font-stretch:${fonts.headingStretch}` : "",
        prim.upper ? "text-transform:uppercase" : "", prim.italic ? "font-style:italic" : ""].filter(Boolean).join(";");
      return `<div class="p t${prim.role === "title" ? " title" : ""}${kind}" style="${style}${motion}">${esc(prim.text)}</div>`;
    }
  }
}

export function slideHtml(deck: Deck, scene: SlideScene, images: ImageMap, label: string, present?: { index: number }) {
  const attrs = present ? ` data-slide="${present.index}"${present.index === 0 ? ' class="slide is-current"' : ' class="slide"'}` : ' class="slide"';
  return `<section${attrs} aria-label="${esc(label)}" style="background:${scene.background}">${scene.prims.map((prim, order) => primHtml(prim, deck, images, present ? order : undefined)).join("")}</section>`;
}

/** Per-direction choreography for the presenter view. Everything is CSS; the
 * frame stays script-free and the host only toggles `is-current`/`is-past`.
 * Titles lead, supporting text follows, marks and art settle last. */
const MOTION: Record<MotionKind, { slide: string; title: string; text: string; shape: string; line: string; keys: string }> = {
  rise: { slide: ".5s|2.2%|.985", title: "mb-rise .8s cubic-bezier(.2,.7,.2,1) both", text: "mb-rise .7s cubic-bezier(.2,.7,.2,1) both", shape: "mb-settle .9s cubic-bezier(.2,.7,.2,1) both", line: "mb-fade .6s ease both",
    keys: "@keyframes mb-rise{from{opacity:0;transform:translateY(1.4cqw)}to{opacity:1;transform:none}}@keyframes mb-settle{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}" },
  wipe: { slide: ".45s|3%|1", title: "mb-wipe .75s cubic-bezier(.7,0,.2,1) both", text: "mb-wipe .6s cubic-bezier(.7,0,.2,1) both", shape: "mb-fade .5s ease both", line: "mb-draw .7s cubic-bezier(.7,0,.2,1) both",
    keys: "@keyframes mb-wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}" },
  fade: { slide: ".9s|0%|1", title: "mb-veil 1.3s cubic-bezier(.25,.1,.25,1) both", text: "mb-veil 1.1s ease both", shape: "mb-fade 1.4s ease both", line: "mb-draw 1.4s cubic-bezier(.4,0,.2,1) both",
    keys: "@keyframes mb-veil{from{opacity:0;transform:translateY(.5cqw);letter-spacing:.02em}to{opacity:1;transform:none}}" },
  pop: { slide: ".45s|2%|.97", title: "mb-rise .7s cubic-bezier(.2,.8,.2,1) both", text: "mb-rise .6s cubic-bezier(.2,.8,.2,1) both", shape: "mb-pop .7s cubic-bezier(.34,1.56,.64,1) both", line: "mb-fade .5s ease both",
    keys: "@keyframes mb-rise{from{opacity:0;transform:translateY(1.4cqw)}to{opacity:1;transform:none}}@keyframes mb-pop{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:none}}" },
  blur: { slide: ".6s|0%|1.02", title: "mb-focus .9s cubic-bezier(.2,.7,.2,1) both", text: "mb-focus .8s ease both", shape: "mb-fade 1s ease both", line: "mb-draw 1s ease both",
    keys: "@keyframes mb-focus{from{opacity:0;filter:blur(.6cqw);transform:translateY(.6cqw)}to{opacity:1;filter:none;transform:none}}" },
  draw: { slide: ".5s|1.5%|1", title: "mb-rise .8s cubic-bezier(.2,.7,.2,1) both", text: "mb-fade .7s ease both", shape: "mb-fade .8s ease both", line: "mb-draw 1.1s cubic-bezier(.6,0,.2,1) both",
    keys: "@keyframes mb-rise{from{opacity:0;transform:translateY(1cqw)}to{opacity:1;transform:none}}" },
  snap: { slide: ".28s|4%|1", title: "mb-snap .45s cubic-bezier(.2,1.3,.4,1) both", text: "mb-snap .4s cubic-bezier(.2,1.3,.4,1) both", shape: "mb-grow .45s cubic-bezier(.2,1,.3,1) both", line: "mb-draw .35s steps(6,end) both",
    keys: "@keyframes mb-snap{from{opacity:0;transform:translateX(-3cqw)}to{opacity:1;transform:none}}@keyframes mb-grow{from{opacity:0;transform:scaleY(.2)}to{opacity:1;transform:none}}" },
};
function presentCss(motion: MotionKind) {
  const m = MOTION[motion], [duration, drift, scale] = m.slide.split("|");
  const stagger = motion === "fade" ? 70 : motion === "snap" ? 28 : 45;
  return `html,body{height:100%;overflow:hidden;background:#0B0B0C}
.stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
.deck{position:relative;width:min(100vw,calc(100vh * 16 / 9));aspect-ratio:16/9}
.deck .slide{position:absolute;inset:0;opacity:0;visibility:hidden;transform:translateX(${drift}) scale(${scale});transition:opacity ${duration} ease,transform ${duration} cubic-bezier(.2,.7,.2,1),visibility 0s linear ${duration}}
.deck .slide.is-past{transform:translateX(-${drift}) scale(${scale})}
.deck .slide.is-current{opacity:1;visibility:visible;transform:none;transition:opacity ${duration} ease,transform ${duration} cubic-bezier(.2,.7,.2,1),visibility 0s}
.deck .slide.is-current .m-title{animation:${m.title};animation-delay:calc(var(--i) * ${Math.round(stagger * 0.4)}ms + 120ms)}
.deck .slide.is-current .m-text{animation:${m.text};animation-delay:calc(var(--i) * ${stagger}ms + 220ms)}
.deck .slide.is-current .m-shape,.deck .slide.is-current .m-img,.deck .slide.is-current .m-chart{animation:${m.shape};animation-delay:calc(var(--i) * ${Math.round(stagger * 0.5)}ms + 40ms);transform-origin:50% 100%}
.deck .slide.is-current .m-art{animation:mb-fade 1.6s ease both;animation-delay:80ms}
.deck .slide.is-current .m-line line,.deck .slide.is-current .m-line{animation:${m.line};animation-delay:calc(var(--i) * ${Math.round(stagger * 0.5)}ms + 60ms)}
.deck .slide.is-current .m-chart rect{animation:mb-grow-bar .9s cubic-bezier(.2,.7,.2,1) both;animation-delay:.35s;transform-box:fill-box;transform-origin:50% 100%}
@keyframes mb-fade{from{opacity:0}to{opacity:1}}@keyframes mb-draw{from{stroke-dasharray:1;stroke-dashoffset:1;opacity:0}to{stroke-dasharray:1;stroke-dashoffset:0;opacity:1}}@keyframes mb-grow-bar{from{transform:scaleY(0)}to{transform:none}}${m.keys}
@media (prefers-reduced-motion:reduce){.deck .slide,.deck .slide.is-current,.deck .slide.is-past{transition:none;transform:none}.deck .slide.is-current *{animation:none!important}}`;
}

/** Complete standalone document. `print` lays out one 1280×720 page per slide
 * for Chromium's PDF printer; `preview` stacks responsive slides with notes;
 * `present` is a full-viewport slideshow with CSS transitions. `fonts` maps
 * embedded faces to data: URLs where the page cannot fetch same-origin files.
 * `limit` renders only the first slides (e.g. a library card's opening slide)
 * while every slide is still composed in the context of the whole deck. */
export function deckHtml(deck: Deck, images: ImageMap, mode: DeckMode = "preview", fonts?: FontSources, limit?: number) {
  const pairing = FONTS[deck.theme.fonts], dir = directionOf(deck.theme);
  const total = deck.slides.length;
  const treatments = new Map<string, ImageTreatment>();
  const slides = deck.slides.slice(0, limit ?? total).map((slide, index) => {
    const scene = composeSlide(deck, slide, index, total);
    for (const prim of scene.prims) if (prim.k === "image" && prim.treatment) treatments.set(filterId(prim.treatment), prim.treatment);
    const html = slideHtml(deck, scene, images, `Slide ${index + 1}: ${slide.title}`, mode === "present" ? { index } : undefined);
    if (mode !== "preview") return html;
    return `<figure class="frame" id="slide-${esc(slide.id)}"><figcaption><b>${String(index + 1).padStart(2, "0")}</b> ${esc(slide.layout)}${scene.composition ? ` · ${esc(scene.composition.replace(/^[a-z]+-/, ""))}` : ""}</figcaption>${html}<details><summary>Speaker notes</summary><p>${esc(slide.notes)}</p></details></figure>`;
  }).join("");
  const filters = treatments.size ? `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${[...treatments].map(([id, t]) => `<filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${treatmentMatrix(t)}"/></filter>`).join("")}</svg>` : "";
  const empty = !total ? `<div class="empty">Slides appear here as they are written.</div>` : "";
  const css = `${fontFaceCss(deckFaces(deck), fonts)}*{box-sizing:border-box}html,body{margin:0}body{--heading:${pairing.heading};--body:${pairing.body};--mono:${MONO_STACK};font-family:var(--body);-webkit-font-smoothing:antialiased;font-kerning:normal;font-optical-sizing:auto}
.slide{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;container-type:inline-size}
.p{position:absolute;margin:0}.t{display:flex;flex-direction:column;white-space:pre-wrap;overflow-wrap:break-word}.t.title{text-wrap:balance}
.ph{display:flex;align-items:center;justify-content:center;background:repeating-linear-gradient(135deg,rgba(127,127,127,.12) 0 12px,rgba(127,127,127,.04) 12px 24px);color:rgba(90,90,90,.9);font:600 1.1cqw/1.3 var(--body);text-align:center;padding:2cqw}
${mode === "print"
    ? `@page{size:${W}px ${H}px;margin:0}body{width:${W}px}.slide{width:${W}px;height:${H}px;break-after:page}.slide:last-child{break-after:auto}`
    : mode === "present" ? presentCss(dir.motion)
    : `body{background:#E9E8E4;padding:28px 24px 64px}.frame{max-width:1120px;margin:0 auto 34px}.frame .slide{border-radius:6px;box-shadow:0 1px 2px rgba(0,0,0,.08),0 12px 32px rgba(20,20,30,.12)}
figcaption{font:12px/1.4 system-ui,sans-serif;color:#6B6B6B;margin:0 0 8px;letter-spacing:.04em;text-transform:uppercase}figcaption b{color:#222;margin-right:6px}
details{font:13px/1.5 system-ui,sans-serif;color:#444;margin-top:8px}summary{cursor:pointer;color:#666}details p{margin:6px 0 0;white-space:pre-wrap;max-width:80ch}
.empty{max-width:1120px;margin:0 auto;aspect-ratio:16/9;border:2px dashed #C9C7C1;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#77756F;font:15px system-ui,sans-serif}`}`;
  const body = mode === "present" ? `<main class="stage"><div class="deck dir-${dir.id}">${slides}</div></main>` : `${slides}${empty}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(deck.title)}</title><style>${css}</style></head><body>${filters}${body}</body></html>`;
}
