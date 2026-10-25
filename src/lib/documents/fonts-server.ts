import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DOCUMENT_FACES, FACE_SUBSETS, PRINT_WEIGHTS, faceFile, faceKey, faceStyles, hasStaticCuts, staticFaceFile, type FaceId, type FontSources } from "./fonts";

const cache = new Map<string, string | null>();

async function dataUrl(key: string, file: string) {
  if (!cache.has(key)) {
    try {
      cache.set(key, `data:font/woff2;base64,${(await readFile(file)).toString("base64")}`);
    } catch {
      cache.set(key, null);
    }
  }
  return cache.get(key) ?? null;
}

/** The offline PDF printer cannot fetch the app's font files, so the faces a
 * document uses are inlined as data: URLs: the latin and latin-ext files of
 * every style. Chromium loads a subset only for text in its unicode-range and
 * embeds only the glyphs it draws, so the extra file does not grow the PDF of
 * an English document. Variable faces are inlined as their static cuts at
 * PRINT_WEIGHTS (fonts.ts: Chromium embeds variable fonts in PDFs as Type 3);
 * a style/subset whose cuts are not all readable falls back to the variable
 * file, and faces with condensed widths (Archivo) also carry the variable file
 * for those widths only. Files come from the installed Fontsource packages
 * (traced into the export route by next.config.ts). A file that cannot be read
 * is skipped; its characters then use the CSS stack's next family. */
export async function embeddedFontSources(ids: readonly FaceId[], root = process.cwd()): Promise<FontSources> {
  const sources: FontSources = {};
  for (const id of new Set(ids)) for (const style of faceStyles(id)) for (const subset of FACE_SUBSETS) {
    const face = DOCUMENT_FACES[id];
    let cuts = 0;
    if (hasStaticCuts(id)) {
      const urls = await Promise.all(PRINT_WEIGHTS.map(weight => dataUrl(faceKey(id, style, subset, weight), path.join(root, "node_modules", "@fontsource", id, "files", staticFaceFile(id, style, weight, subset)))));
      if (urls.every(Boolean)) PRINT_WEIGHTS.forEach((weight, index) => { sources[faceKey(id, style, subset, weight)] = urls[index]!; cuts++; });
      else console.warn(`document font ${id}:${style}:${subset} static cuts unavailable; the PDF embeds the variable file`);
    }
    if (cuts && !("stretch" in face)) continue;
    const key = faceKey(id, style, subset), url = await dataUrl(key, path.join(root, "node_modules", face.pkg, id, "files", faceFile(id, style, subset)));
    if (url) sources[key] = url;
    else console.warn(`document font ${key} unavailable; the PDF uses the fallback stack`);
  }
  return sources;
}
