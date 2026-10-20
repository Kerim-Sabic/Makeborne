import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DOCUMENT_FACES, FACE_SUBSETS, faceFile, faceKey, faceStyles, type FaceId, type FontSources } from "./fonts";

const cache = new Map<string, string>();

/** The offline PDF printer cannot fetch the app's font files, so the faces a
 * document uses are inlined as data: URLs: the latin and latin-ext files of
 * every style. Chromium loads a subset only for text in its unicode-range and
 * embeds only the glyphs it draws, so the extra file does not grow the PDF of
 * an English document. Files come from the installed Fontsource packages
 * (traced into the export route by next.config.ts). A file that cannot be read
 * is skipped; its characters then use the CSS stack's next family. */
export async function embeddedFontSources(ids: readonly FaceId[], root = process.cwd()): Promise<FontSources> {
  const sources: FontSources = {};
  for (const id of new Set(ids)) for (const style of faceStyles(id)) for (const subset of FACE_SUBSETS) {
    const key = faceKey(id, style, subset);
    let url = cache.get(key);
    if (!url) {
      try {
        const bytes = await readFile(path.join(root, "node_modules", DOCUMENT_FACES[id].pkg, id, "files", faceFile(id, style, subset)));
        url = `data:font/woff2;base64,${bytes.toString("base64")}`;
        cache.set(key, url);
      } catch {
        console.warn(`document font ${key} unavailable; the PDF uses the fallback stack`);
        continue;
      }
    }
    sources[key] = url;
  }
  return sources;
}
