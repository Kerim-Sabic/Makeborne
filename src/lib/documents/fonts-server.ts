import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DOCUMENT_FACES, faceFile, faceKey, faceStyles, type FaceId, type FontSources } from "./fonts";

const cache = new Map<string, string>();

/** The offline PDF printer cannot fetch the app's font files, so the faces a
 * document uses are inlined as data: URLs. Files come from the installed
 * Fontsource packages (traced into the export route by next.config.ts). A face
 * that cannot be read is skipped; its CSS stack then falls back as before. */
export async function embeddedFontSources(ids: readonly FaceId[], root = process.cwd()): Promise<FontSources> {
  const sources: FontSources = {};
  for (const id of new Set(ids)) for (const style of faceStyles(id)) {
    const key = faceKey(id, style);
    let url = cache.get(key);
    if (!url) {
      try {
        const bytes = await readFile(path.join(root, "node_modules", DOCUMENT_FACES[id].pkg, id, "files", faceFile(id, style)));
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
