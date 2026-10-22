/* eslint-disable @typescript-eslint/no-require-imports -- Local document design-quality harness. Offline: no network, no providers, no paid calls. */
// Renders fixture DocumentSource JSON through the real renderers:
//   decks  -> deckHtml(print) in Chromium -> one PNG per slide + PDF
//          -> deckPptx -> .pptx -> an HTML reconstruction of every PPTX slide
//             (from the package XML, with the PPTX font faces and line spacing)
//             -> PNG, plus measured text fit for every PPTX text box
//   books  -> bookHtml(print) -> PDF -> page PNGs (PyMuPDF or poppler when present)
// --server-fonts additionally renders the print HTML as the production PDF
// exporter sees it: @sparticuz/chromium on Linux ships only Open Sans, so every
// system family in the stacks is unavailable there.
//
// Usage: node scripts/render-document-quality.cjs --fixtures <dir> --out <dir> [--only a,b] [--server-fonts] [--images <dir>]
// --images: real artwork for a fixture, <dir>/<asset name>.webp|.png|.jpg, used instead of the stand-in where present.
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib"), Module = require("node:module"), { spawnSync } = require("node:child_process");
const ts = require("typescript");
const args = process.argv.slice(2), arg = (name, fallback) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : fallback; };
const app = path.resolve(arg("app", process.cwd()));
const fixturesDir = path.resolve(arg("fixtures", path.join(app, "work/generation-quality-20261014/documents/fixtures")));
const outDir = path.resolve(arg("out", path.join(app, "work/generation-quality-20261014/documents/out")));
const only = arg("only", "") ? arg("only").split(",") : null;
const serverFonts = args.includes("--server-fonts");
const imagesDir = arg("images", "") ? path.resolve(arg("images")) : null;
/** Real artwork from --images (as JPEG, like the exporter), else null. */
const realArtwork = async (asset) => { const file = imagesDir && ["webp", "png", "jpg"].map(ext => path.join(imagesDir, `${asset.name}.${ext}`)).find(fs.existsSync); return file ? require("sharp")(file).jpeg({ quality: 88 }).toBuffer() : null; };

global.fetch = () => { throw new Error("Network access is forbidden in this harness."); };
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const src = (file) => require(path.join(app, "src/lib/documents", file));
const { DocumentSourceSchema } = src("schema.ts");
const { deckHtml, deckFaces } = src("render-deck.ts");
const { bookHtml } = src("render-book.ts");
const { composeSlide } = src("slide-scene.ts");
const { deckPptx } = src("pptx.ts");
const { FONTS } = src("theme.ts");
let pagination = null;
try { pagination = src("book-pagination.ts"); } catch { /* older trees print books once */ }
let imageLuma = null;
try { ({ imageLuma } = src("image-luma.ts")); } catch { /* older trees have no brightness map */ }
let fontServer = null;
try { fontServer = src("fonts-server.ts"); } catch { /* the pre-change tree has no embedded document fonts */ }
const modulesRoot = path.dirname(path.dirname(path.dirname(require.resolve("playwright/package.json"))));
/** The PDF exporter inlines the theme's faces; do the same here. */
const printFonts = async (doc) => fontServer && FONTS[doc.theme.fonts].faces ? [await fontServer.embeddedFontSources(doc.kind === "deck" && deckFaces ? deckFaces(doc) : FONTS[doc.theme.fonts].faces, modulesRoot)] : [];
const { chromium } = require("playwright");
const sharp = require("sharp"), JSZip = require("jszip");

/** Deterministic photographic stand-ins for generated images (no network, no models):
 * a soft-lit landscape of sky, hills and a sun in the theme's palette, so image-led
 * compositions and image treatments can be judged without abstract placeholder blocks. */
async function artwork(asset, theme) {
  const [w, h] = asset.aspect === "portrait" ? [1200, 1600] : asset.aspect === "square" ? [1400, 1400] : [1800, 1200];
  const p = theme.palette;
  let seed = [...asset.name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const ridge = (base, amp, n) => { const pts = Array.from({ length: n + 1 }, (_, i) => [w * i / n, base + (rand() - 0.5) * amp]); return `M0 ${h} L${pts.map(([x, y]) => `${x.toFixed(0)} ${y.toFixed(0)}`).join(" L")} L${w} ${h} Z`; };
  const sunX = w * (0.25 + rand() * 0.5), sunY = h * (0.28 + rand() * 0.12), sunR = Math.min(w, h) * 0.09;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.accent2}"/><stop offset="0.6" stop-color="${p.surface}"/><stop offset="1" stop-color="${p.background}"/></linearGradient><radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.95"/><stop offset="0.35" stop-color="${p.accent}" stop-opacity="0.65"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/></radialGradient><filter id="soft"><feGaussianBlur stdDeviation="${(w / 400).toFixed(1)}"/></filter></defs>
<rect width="100%" height="100%" fill="url(#sky)"/><circle cx="${sunX}" cy="${sunY}" r="${sunR * 3.2}" fill="url(#sun)"/><circle cx="${sunX}" cy="${sunY}" r="${sunR}" fill="#FFF8EC" opacity="0.9"/>
<g filter="url(#soft)"><path d="${ridge(h * 0.55, h * 0.12, 9)}" fill="${p.accent2}" opacity="0.55"/><path d="${ridge(h * 0.66, h * 0.1, 7)}" fill="${p.dark}" opacity="0.55"/></g><path d="${ridge(h * 0.78, h * 0.08, 5)}" fill="${p.dark}" opacity="0.85"/><path d="${ridge(h * 0.9, h * 0.05, 4)}" fill="${p.ink}" opacity="0.9"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toBuffer();
}

/** Production PDF fonts: only Open Sans exists in @sparticuz/chromium. */
function serverFontHtml(html) {
  const modules = path.dirname(path.dirname(require.resolve("playwright/package.json")));
  const tarPath = path.join(modules, "@sparticuz/chromium/bin/fonts.tar.br");
  const tar = zlib.brotliDecompressSync(fs.readFileSync(tarPath)), files = {};
  for (let at = 0; at < tar.length;) {
    const name = tar.subarray(at, at + 100).toString().replace(/\0.*$/s, ""); if (!name) break;
    const size = parseInt(tar.subarray(at + 124, at + 136).toString().replace(/\0.*$/s, "").trim() || "0", 8);
    files[name] = tar.subarray(at + 512, at + 512 + size); at += 512 + Math.ceil(size / 512) * 512;
  }
  const face = (file, weight, style) => `@font-face{font-family:"ServerOpenSans";font-weight:${weight};font-style:${style};src:url(data:font/ttf;base64,${files[`fonts/Open_Sans/${file}`].toString("base64")})}`;
  const faces = face("OpenSans-Regular.ttf", "100 599", "normal") + face("OpenSans-Bold.ttf", "600 900", "normal") + face("OpenSans-Italic.ttf", "100 900", "italic");
  // Every non-generic family that is not embedded with @font-face is absent on the server.
  const embedded = new Set([...html.matchAll(/@font-face\{font-family:"([^"]+)"/g)].map(match => match[1]));
  const strip = (stack) => {
    const parts = stack.split(",").map(part => part.trim()).filter(Boolean);
    const kept = parts.filter(part => { const name = part.replace(/^["']|["']$/g, "").replace(/^&quot;|&quot;$/g, ""); return /^(serif|sans-serif|monospace|var\(.*\))$/.test(name) || embedded.has(name); })
      .map(part => /^(serif|sans-serif|monospace)$/.test(part) ? '"ServerOpenSans"' : part);
    return kept.length ? kept.join(",") : '"ServerOpenSans"';
  };
  return html.replace(/(font-family:|--heading:|--body:)([^;}"]*(?:"[^"]*"[^;}"]*)*)/g, (_m, key, stack) => `${key}${strip(stack)}`)
    .replace(/font-family="([^"]*)"/g, (_m, stack) => `font-family="${strip(stack.replace(/&quot;/g, '"')).replace(/"/g, "&quot;")}"`)
    .replace(/(@(?:top|bottom)-(?:left|right)\{[^}]*?font-family:)([^;]*)/g, (_m, key, stack) => `${key}${strip(stack)}`)
    .replace("<style>", `<style>${faces}`);
}

// ---------- PPTX reconstruction ----------
const EMU = 9525; // EMU per CSS px at 96 dpi
const attr = (xml, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(xml); return m ? m[1] : undefined; };
const unxml = (value) => value.replace(/&#x([0-9A-Fa-f]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec))).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const escHtml = (value) => value.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function fillOf(xml) {
  // "<a:ln" also prefixes custom-geometry <a:lnTo> points; only the outline element ends the fill.
  if (!xml || /<a:noFill\/>/.test(xml.split(/<a:ln[ >\/]/)[0])) return null;
  const m = /<a:solidFill><a:srgbClr val="([0-9A-Fa-f]{6})"(?:\/>|>([\s\S]*?)<\/a:srgbClr>)/.exec(xml);
  if (!m) return null;
  const alpha = m[2] && /<a:alpha val="(\d+)"/.exec(m[2]);
  return { color: `#${m[1]}`, alpha: alpha ? Number(alpha[1]) / 100000 : 1 };
}
async function pptxSlides(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
  const slides = [];
  for (const name of names) {
    const xml = await zip.file(name).async("string");
    const relsXml = await zip.file(name.replace("slides/", "slides/_rels/") + ".rels")?.async("string") ?? "";
    const rels = Object.fromEntries([...relsXml.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]));
    const bg = /<p:bg>[\s\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(xml);
    const shapes = [];
    for (const m of xml.matchAll(/<(p:sp|p:pic|p:graphicFrame|p:cxnSp)>([\s\S]*?)<\/\1>/g)) {
      const [, type, body] = m;
      const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(body) || /<p:xfrm>[\s\S]*?<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(body);
      const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(body);
      if (!off || !ext) continue;
      const box = { x: +off[1] / EMU, y: +off[2] / EMU, w: +ext[1] / EMU, h: +ext[2] / EMU };
      const shape = { type, ...box, flipH: /flipH="1"/.test(body), flipV: /flipV="1"/.test(body), prst: attr(/<a:prstGeom [^>]*>/.exec(body)?.[0] ?? "", "prst") };
      const geom = /<a:path w="\d+" h="\d+">([\s\S]*?)<\/a:path>/.exec(body);
      if (/<a:custGeom>/.test(body) && geom) {
        const pt = (x, y) => `${(+x / EMU + box.x).toFixed(1)} ${(+y / EMU + box.y).toFixed(1)}`;
        shape.path = [...geom[1].matchAll(/<a:(moveTo|lnTo|cubicBezTo)>([\s\S]*?)<\/a:(?:moveTo|lnTo|cubicBezTo)>|<a:close\s*\/>/g)].map(([, op, inner]) => {
          if (!op) return "Z";
          const pts = [...inner.matchAll(/<a:pt x="(-?\d+)" y="(-?\d+)"\s*\/>/g)].map(m => pt(m[1], m[2]));
          return op === "moveTo" ? `M${pts[0]}` : op === "lnTo" ? `L${pts[0]}` : `C${pts.join(" ")}`;
        }).join(" ");
      }
      if (type === "p:pic") {
        const embed = attr(body, "r:embed"), target = embed && rels[embed];
        if (target) { const file = zip.file(path.posix.normalize(path.posix.join("ppt/slides", target))); if (file) shape.src = `data:image/${/\.png$/i.test(target) ? "png" : "jpeg"};base64,${await file.async("base64")}`; }
      } else if (type === "p:graphicFrame") shape.chart = /c:chart/.test(body);
      const spPr = /<p:spPr>([\s\S]*?)<\/p:spPr>/.exec(body)?.[1] ?? "";
      const grad = /<a:gradFill[\s\S]*?<a:gs pos="100000"><a:srgbClr val="([0-9A-Fa-f]{6})"><a:alpha val="(\d+)"\/>/.exec(spPr);
      if (grad) shape.gradient = { color: `#${grad[1]}`, alpha: Number(grad[2]) / 100000, to: { 0: "right", 10800000: "left" }[Number(/<a:lin ang="(\d+)"/.exec(spPr)?.[1])] ?? "bottom" };
      shape.fill = fillOf(spPr.replace(/<a:ln(?: [^>]*)?>[\s\S]*?<\/a:ln>|<a:ln(?: [^>]*)?\/>/, ""));
      const ln = /<a:ln(?: [^>]*)?>([\s\S]*?)<\/a:ln>/.exec(spPr) ?? /<a:ln(?: [^>]*)?\/>/.exec(spPr);
      if (ln && ln[1] && !/<a:noFill\/>/.test(ln[1])) shape.line = { ...fillOf(ln[1]), width: Number(attr(ln[0], "w") ?? 12700) / EMU };
      const radius = /<a:gd name="adj" fmla="val (\d+)"\/>/.exec(spPr);
      if (radius) shape.radius = Number(radius[1]) / 100000;
      const txBody = /<p:txBody>([\s\S]*?)<\/p:txBody>/.exec(body)?.[1];
      if (txBody) {
        const bodyPr = /<a:bodyPr[^>]*\/?>/.exec(txBody)?.[0] ?? "";
        shape.text = {
          insets: ["lIns", "tIns", "rIns", "bIns"].map((key, i) => attr(bodyPr, key) !== undefined ? Number(attr(bodyPr, key)) / EMU : [9.6, 4.8, 9.6, 4.8][i]),
          anchor: attr(bodyPr, "anchor") ?? "t", autofit: /<a:normAutofit/.test(txBody) ? "shrink" : /<a:spAutoFit/.test(txBody) ? "resize" : "none",
          wrap: attr(bodyPr, "wrap") !== "none",
          paragraphs: [...txBody.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map(([, p]) => {
            const pPr = /<a:pPr[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/.exec(p)?.[0] ?? "";
            const pct = /<a:lnSpc><a:spcPct val="(\d+)"\/>/.exec(pPr), pts = /<a:lnSpc><a:spcPts val="(\d+)"\/>/.exec(pPr);
            const runs = [...p.matchAll(/<a:r>([\s\S]*?)<\/a:r>|<a:br\/>/g)].map(([whole, r]) => {
              if (!r) return { br: true };
              const rPr = /<a:rPr[^>]*?(?:\/>|>[\s\S]*?<\/a:rPr>)/.exec(r)?.[0] ?? "";
              return { text: unxml(/<a:t>([\s\S]*?)<\/a:t>/.exec(r)?.[1] ?? ""), size: Number(attr(rPr, "sz") ?? 1800) / 100, bold: attr(rPr, "b") === "1", italic: attr(rPr, "i") === "1", caps: attr(rPr, "cap") === "all", spc: Number(attr(rPr, "spc") ?? 0) / 100, color: fillOf(rPr)?.color ?? "#000000", face: attr(/<a:latin [^>]*>/.exec(rPr)?.[0] ?? "", "typeface") ?? "Calibri", whole };
            });
            const bu = /<a:buChar char="([^"]*)"/.exec(pPr)?.[1], buClr = /<a:buClr><a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(pPr)?.[1], after = /<a:spcAft><a:spcPts val="(\d+)"/.exec(pPr);
            return { marL: Number(attr(pPr, "marL") ?? 0) / EMU, bullet: bu ? { char: unxml(bu), color: buClr ? `#${buClr}` : null } : null, after: after ? Number(after[1]) / 100 * 4 / 3 : 0, align: attr(pPr, "algn") ?? "l", spacing: pts ? { pts: Number(pts[1]) / 100 } : pct ? { pct: Number(pct[1]) / 100000 } : { pct: 1 }, runs };
          }),
        };
      }
      shapes.push(shape);
    }
    slides.push({ name, background: bg ? `#${bg[1]}` : "#FFFFFF", shapes });
  }
  return slides;
}
/** HTML that lays the PPTX shapes out like PowerPoint: exact boxes, the PPTX typeface,
 * PowerPoint line spacing (multiple of the face's single line, or exact points). */
function pptxSlideHtml(slide) {
  const parts = slide.shapes.map((s, index) => {
    const box = `left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px`;
    if (s.type === "p:pic") return s.src ? `<img style="position:absolute;${box};object-fit:fill" src="${s.src}">` : "";
    if (s.type === "p:graphicFrame") return `<div class="chart" style="position:absolute;${box}">native chart</div>`;
    if (s.path !== undefined) return `<svg style="position:absolute;left:0;top:0;width:1280px;height:720px;overflow:visible"><path d="${s.path}" fill="${s.fill ? s.fill.color : "none"}" fill-opacity="${s.fill ? s.fill.alpha : 1}"${s.line ? ` stroke="${s.line.color}" stroke-width="${s.line.width}"` : ""}/></svg>`;
    if (s.prst === "line") {
      const [x1, x2] = s.flipH ? [s.x + s.w, s.x] : [s.x, s.x + s.w], [y1, y2] = s.flipV ? [s.y + s.h, s.y] : [s.y, s.y + s.h];
      return s.line ? `<svg style="position:absolute;left:0;top:0;width:1280px;height:720px;overflow:visible"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${s.line.color}" stroke-opacity="${s.line.alpha}" stroke-width="${s.line.width}"/></svg>` : "";
    }
    const rgbaOf = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
    const shapeStyle = [box, s.gradient ? `background:linear-gradient(to ${s.gradient.to},${rgbaOf(s.gradient.color, 0)} 0%,${rgbaOf(s.gradient.color, s.gradient.alpha * 0.75)} 55%,${rgbaOf(s.gradient.color, s.gradient.alpha)} 100%)` : s.fill ? `background:${s.fill.color};` + (s.fill.alpha < 1 ? `opacity:${s.fill.alpha}` : "") : "", s.line ? `outline:${s.line.width}px solid ${s.line.color};outline-offset:-${s.line.width / 2}px` : "",
      s.prst === "ellipse" ? "border-radius:50%" : s.prst === "roundRect" ? `border-radius:${(s.radius ?? 0.1667) * Math.min(s.w, s.h)}px` : ""].filter(Boolean).join(";");
    let html = `<div style="position:absolute;${shapeStyle}"></div>`;
    if (s.text && s.text.paragraphs.some(p => p.runs.some(r => r.text))) {
      const [l, t, r, b] = s.text.insets;
      const paragraphs = s.text.paragraphs.map(p => {
        const first = p.runs.find(run => !run.br) ?? { size: 18, face: "Calibri" };
        const lineHeight = p.spacing.pts ? `${p.spacing.pts * 4 / 3}px` : `calc(var(--normal-${CSS_ID(first.face)}) * ${p.spacing.pct} * ${first.size * 4 / 3}px)`;
        // The paragraph's own font sets the line strut, as PowerPoint measures lines from the run.
        const marker = p.bullet ? `<span style="position:absolute;left:0;color:${p.bullet.color ?? first.color}">${escHtml(p.bullet.char)}</span>` : "";
        return `<div class="para" style="position:relative;padding-left:${p.marL}px;margin-bottom:${p.after}px;font-family:'${first.face}';font-size:${first.size * 4 / 3}px;text-align:${{ l: "left", ctr: "center", r: "right", just: "justify" }[p.align] ?? "left"};line-height:${lineHeight}">${marker}${p.runs.map(run => run.br ? "<br>" : `<span style="font-family:'${run.face}';font-size:${run.size * 4 / 3}px;font-weight:${run.bold ? 700 : 400};font-style:${run.italic ? "italic" : "normal"};${run.caps ? "text-transform:uppercase;" : ""}color:${run.color};letter-spacing:${run.spc * 4 / 3}px">${escHtml(run.text)}</span>`).join("") || "&nbsp;"}</div>`;
      }).join("");
      html += `<div class="tb" data-index="${index}" data-box-h="${s.h}" style="position:absolute;${box};padding:${t}px ${r}px ${b}px ${l}px;justify-content:${{ t: "flex-start", ctr: "center", b: "flex-end" }[s.text.anchor] ?? "flex-start"}"><div class="inner">${paragraphs}</div></div>`;
    }
    return html;
  }).join("");
  return `<section class="slide" style="background:${slide.background}">${parts}</section>`;
}
const CSS_ID = (face) => face.replace(/[^A-Za-z0-9]/g, "_");
function pptxDocumentHtml(slides) {
  const faces = [...new Set(slides.flatMap(slide => slide.shapes.flatMap(s => s.text ? s.text.paragraphs.flatMap(p => p.runs.filter(r => !r.br).map(r => r.face)) : [])))];
  return { faces, html: `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0}.slide{position:relative;width:1280px;height:720px;overflow:hidden}
.tb{display:flex;flex-direction:column;overflow:visible}.inner{white-space:normal;overflow-wrap:anywhere}.para{margin:0}
.chart{display:flex;align-items:center;justify-content:center;border:1.5px dashed rgba(120,120,120,.6);color:rgba(90,90,90,.9);font:600 13px system-ui;background:rgba(127,127,127,.06)}</style></head><body>${slides.map(pptxSlideHtml).join("")}</body></html>` };
}

async function measureNormalLineHeights(page, faces) {
  return page.evaluate(async (faces) => {
    const out = {};
    for (const face of faces) {
      const d = document.createElement("div"); d.style.cssText = `position:absolute;font:400 100px '${face}';line-height:normal`; d.textContent = "Hg"; document.body.appendChild(d);
      out[face] = d.getBoundingClientRect().height / 100; d.remove();
    }
    return out;
  }, faces);
}

async function renderDeck(browser, name, doc, images, dir, report) {
  const urls = Object.fromEntries(Object.entries(images).map(([key, bytes]) => [key, `data:image/jpeg;base64,${bytes.toString("base64")}`]));
  const scenes = doc.slides.map((slide, index) => composeSlide(doc, slide, index, doc.slides.length));
  report.sceneIssues = scenes.flatMap((scene, index) => scene.issues.map(issue => `slide ${index + 1}: ${issue}`));
  report.layouts = doc.slides.map(slide => slide.layout);
  const variants = [["print", deckHtml(doc, urls, "print", ...(await printFonts(doc)))]];
  if (serverFonts) variants.push(["server-pdf", serverFontHtml(variants[0][1])]);
  for (const [variant, html] of variants) {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block", viewport: { width: 1280, height: 720 } });
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => document.fonts.ready);
    const prefix = variant === "print" ? "slide" : "server-slide";
    const count = await page.locator(".slide").count();
    for (let i = 0; i < count; i++) await page.locator(".slide").nth(i).screenshot({ path: path.join(dir, `${prefix}-${String(i + 1).padStart(2, "0")}.png`) });
    const overflow = await page.evaluate(() => [...document.querySelectorAll(".slide")].flatMap((slide, index) => {
      const s = slide.getBoundingClientRect();
      return [...slide.querySelectorAll(".t")].flatMap(element => {
        // Line boxes, not glyph content areas: tall-ascender faces report inline
        // boxes beyond a tight line-height even when nothing visibly spills.
        const box = element.getBoundingClientRect(), height = element.style.height;
        element.style.height = "auto"; const natural = element.getBoundingClientRect().height; element.style.height = height;
        const range = document.createRange(); range.selectNodeContents(element);
        const rects = [...range.getClientRects()]; if (!rects.length) return [];
        const right = Math.max(...rects.map(r => r.right)), lines = new Set(rects.map(r => Math.round(r.top))).size;
        const problems = [];
        if (natural > box.height + 2) problems.push(`needs ${Math.round(natural)}px in a ${Math.round(box.height)}px box (+${Math.round(natural - box.height)}px, ${lines} lines)`);
        // Hanging pre-wrap spaces extend the range but not the layout; scrollWidth does not count them.
        if (element.scrollWidth > element.clientWidth + 1) problems.push(`runs ${element.scrollWidth - element.clientWidth}px past its box`);
        if (box.top + natural > s.bottom || right > s.right) problems.push("leaves the slide");
        return problems.length ? [{ slide: index + 1, text: element.textContent.slice(0, 60), problems }] : [];
      });
    }));
    const usedFonts = await page.evaluate(() => [...new Set([...document.querySelectorAll(".t")].map(element => getComputedStyle(element).fontFamily))]);
    report[variant === "print" ? "htmlOverflow" : "serverOverflow"] = overflow;
    report[variant === "print" ? "htmlFontStacks" : "serverFontStacks"] = usedFonts;
    // server-deck.pdf: what the production printer embeds (only the @font-face faces exist there).
    fs.writeFileSync(path.join(dir, variant === "print" ? "deck.pdf" : "server-deck.pdf"), await page.pdf({ printBackground: true, preferCSSPageSize: true, tagged: true }));
    if (variant === "print") fs.writeFileSync(path.join(dir, "deck-print.html"), html.length < 4e6 ? html : html.slice(0, 2000));
    await context.close();
  }
  // Native PPTX and its reconstruction.
  const pptx = await deckPptx(doc, images);
  fs.writeFileSync(path.join(dir, "deck.pptx"), pptx);
  const zip = await JSZip.loadAsync(pptx);
  report.pptxTransitions = (await Promise.all(Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(n => zip.file(n).async("string")))).filter(xml => /<p:transition/.test(xml)).length;
  const slides = await pptxSlides(pptx);
  const { faces, html } = pptxDocumentHtml(slides);
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 720 } });
  await context.route("**/*", route => route.abort());
  const page = await context.newPage();
  await page.setContent("<body></body>");
  const normal = await measureNormalLineHeights(page, faces);
  await page.setContent(html.replace("</style>", `:root{${faces.map(face => `--normal-${CSS_ID(face)}:${normal[face]}`).join(";")}}</style>`), { waitUntil: "load" });
  for (let i = 0; i < slides.length; i++) await page.locator(".slide").nth(i).screenshot({ path: path.join(dir, `pptx-${String(i + 1).padStart(2, "0")}.png`) });
  report.pptxFaces = faces;
  report.pptxNormalLineHeights = normal;
  report.pptxLineSpacing = [...new Set(slides.flatMap(slide => slide.shapes.flatMap(s => s.text ? s.text.paragraphs.map(p => p.spacing.pts ? "exact points" : "multiple") : [])))];
  report.pptxOverflow = await page.evaluate(() => [...document.querySelectorAll(".slide")].flatMap((slide, index) => [...slide.querySelectorAll(".tb")].flatMap(tb => {
    const inner = tb.querySelector(".inner"), style = getComputedStyle(tb);
    const need = inner.getBoundingClientRect().height + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom), have = Number(tb.dataset.boxH);
    const wide = Math.max(...[...inner.querySelectorAll("span")].map(span => span.getBoundingClientRect().right)) - tb.getBoundingClientRect().right;
    const problems = [];
    if (need > have + 2) problems.push(`needs ${Math.round(need)}px in a ${Math.round(have)}px box (+${Math.round(need - have)}px)`);
    if (wide > 2) problems.push(`a word runs ${Math.round(wide)}px wide`);
    return problems.length ? [{ slide: index + 1, text: inner.textContent.slice(0, 60), problems }] : [];
  })));
  // Geometry parity: every scene text box must exist in the PPTX at the same place.
  report.pptxGeometry = scenes.map((scene, index) => {
    const texts = scene.prims.filter(prim => prim.k === "text"), shapes = slides[index].shapes.filter(shape => shape.text);
    const missing = texts.filter(prim => !shapes.some(shape => Math.abs(shape.x - prim.x) < 1 && Math.abs(shape.y - prim.y) < 1 && Math.abs(shape.w - prim.w) < 1 && Math.abs(shape.h - prim.h) < 1));
    return { slide: index + 1, textBoxes: texts.length, mismatched: missing.length };
  }).filter(entry => entry.mismatched);
  await context.close();
}

function rasterizePdf(pdf, prefix, dpi = 110) {
  const script = `import fitz,sys\ndoc=fitz.open(sys.argv[1])\nfor i,p in enumerate(doc):\n  p.get_pixmap(dpi=int(sys.argv[3])).save(f"{sys.argv[2]}-{i+1:02d}.png")\nprint(len(doc))`;
  const py = spawnSync("python", ["-I", "-c", script, pdf, prefix, String(dpi)], { encoding: "utf8", windowsHide: true, timeout: 180000 });
  if (py.status === 0) return Number(py.stdout.trim());
  const poppler = path.join(process.env.USERPROFILE ?? "", ".cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe");
  if (fs.existsSync(poppler)) { const r = spawnSync(poppler, ["-r", String(dpi), "-png", pdf, prefix], { windowsHide: true }); if (r.status === 0) return fs.readdirSync(path.dirname(prefix)).filter(f => f.startsWith(path.basename(prefix))).length; }
  return 0;
}

async function renderBook(browser, name, doc, images, dir, report) {
  const urls = Object.fromEntries(Object.entries(images).map(([key, bytes]) => [key, `data:image/jpeg;base64,${bytes.toString("base64")}`]));
  const fonts = await printFonts(doc);
  let html = bookHtml(doc, urls, "print", ...fonts);
  // As the PDF exporter does: a first print's bookmarks give the contents page numbers and the recto blanks.
  if (pagination) {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block", viewport: { width: 576, height: 864 } });
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" }); await page.emulateMedia({ media: "print" }); await page.evaluate(() => document.fonts.ready);
    const pages = pagination.bookPagesFromOutline(doc, pagination.pdfOutline(await page.pdf({ printBackground: true, preferCSSPageSize: true, tagged: true, outline: true })));
    await context.close();
    if (pages) { report.pagination = pages; html = bookHtml(doc, urls, "print", fonts[0], pages); }
  }
  const variants = [["print", html]];
  if (serverFonts) variants.push(["server-pdf", serverFontHtml(variants[0][1])]);
  for (const [variant, html] of variants) {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block", viewport: { width: 576, height: 864 } });
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => document.fonts.ready);
    const pdfPath = path.join(dir, variant === "print" ? "book.pdf" : "server-book.pdf");
    const printed = Buffer.from(await page.pdf({ printBackground: true, preferCSSPageSize: true, tagged: true, outline: true }));
    fs.writeFileSync(pdfPath, pagination?.fixPdfBookmarks ? pagination.fixPdfBookmarks(printed, pagination.bookHeadings(doc)) : printed);
    const pages = rasterizePdf(pdfPath, path.join(dir, variant === "print" ? "page" : "server-page"));
    if (pagination && variant === "print") report.bookmarks = pagination.pdfOutline(fs.readFileSync(pdfPath)).map(entry => `${entry.page}: ${entry.title}`);
    report[variant === "print" ? "pages" : "serverPages"] = pages;
    if (variant === "print") report.fontStacks = await page.evaluate(() => [...new Set([...document.querySelectorAll("h1,h2,h3,p,li,td")].map(element => getComputedStyle(element).fontFamily))]);
    if (variant === "print") fs.writeFileSync(path.join(dir, "book-print.html"), html);
    await context.close();
  }
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const summary = {};
  try {
    for (const file of fs.readdirSync(fixturesDir).filter(f => f.endsWith(".json")).sort()) {
      const name = file.replace(/\.json$/, "");
      if (only && !only.includes(name)) continue;
      const doc = DocumentSourceSchema.parse(JSON.parse(fs.readFileSync(path.join(fixturesDir, file), "utf8")));
      const dir = path.join(outDir, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      const images = {}; for (const asset of doc.assets) images[asset.name] = (await realArtwork(asset)) ?? await artwork(asset, doc.theme);
      // Measured brightness, as the builder stores it for generated images (scrims over text are sized from it).
      if (imageLuma) for (const asset of doc.assets) if (!asset.luma) asset.luma = await imageLuma(images[asset.name]);
      const report = { fixture: name, kind: doc.kind, fonts: doc.theme.fonts };
      if (doc.kind === "deck") await renderDeck(browser, name, doc, images, dir, report);
      else await renderBook(browser, name, doc, images, dir, report);
      fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");
      summary[name] = report;
      console.log(`${name}: ${doc.kind === "deck" ? `${doc.slides.length} slides, scene issues ${report.sceneIssues.length}, html overflow ${report.htmlOverflow.length}${serverFonts ? `, server-font overflow ${report.serverOverflow.length}` : ""}, pptx overflow ${report.pptxOverflow.length}, pptx geometry mismatches ${report.pptxGeometry.length}, transitions ${report.pptxTransitions}` : `${report.pages} pages${serverFonts ? ` (server fonts: ${report.serverPages})` : ""}`}`);
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
})().catch(error => { console.error(error); process.exitCode = 1; });
