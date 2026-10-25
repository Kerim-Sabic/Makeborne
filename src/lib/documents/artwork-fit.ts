import "server-only";
import sharp from "sharp";

/** Artwork limits of a document export, the same as the block exporter's (src/lib/server/export.ts prepareExport):
 * each embedded image under 3 MB and all artwork together under 12 MB. Generated book and deck images are re-encoded
 * to fit (smaller JPEG quality first, then fewer pixels) rather than refused, so an illustrated book always exports. */
export const ARTWORK_IMAGE_LIMIT = 3_000_000;
export const ARTWORK_TOTAL_LIMIT = 12_000_000;
const STEPS: { edge: number; quality: number }[] = [
  { edge: 2000, quality: 88 }, { edge: 2000, quality: 80 }, { edge: 1800, quality: 74 }, { edge: 1600, quality: 70 },
  { edge: 1400, quality: 66 }, { edge: 1200, quality: 62 }, { edge: 1000, quality: 58 },
];

async function encode(bytes: Buffer, step: { edge: number; quality: number }) {
  return sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: step.edge, height: step.edge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: step.quality, mozjpeg: true }).toBuffer();
}

/** JPEG copies of every image, each under `perImage` bytes and all together under `total`: every image starts at the
 * print step (2000 px, quality 88) and the largest are stepped down until the set fits. */
export async function fitArtwork(buffers: Record<string, Buffer>, limits: { perImage?: number; total?: number } = {}) {
  const perImage = limits.perImage ?? ARTWORK_IMAGE_LIMIT, total = limits.total ?? ARTWORK_TOTAL_LIMIT;
  const out: Record<string, { bytes: Buffer; step: number }> = {};
  for (const [name, bytes] of Object.entries(buffers)) {
    let step = 0, jpeg = await encode(bytes, STEPS[0]);
    while (jpeg.length > perImage && step < STEPS.length - 1) jpeg = await encode(bytes, STEPS[++step]);
    out[name] = { bytes: jpeg, step };
  }
  const sum = () => Object.values(out).reduce((acc, entry) => acc + entry.bytes.length, 0);
  while (sum() > total) {
    const [name, largest] = Object.entries(out).filter(([, entry]) => entry.step < STEPS.length - 1).sort((a, b) => b[1].bytes.length - a[1].bytes.length)[0] ?? [];
    if (!name || !largest) break;
    out[name] = { bytes: await encode(buffers[name], STEPS[largest.step + 1]), step: largest.step + 1 };
  }
  return Object.fromEntries(Object.entries(out).map(([name, entry]) => [name, entry.bytes]));
}
