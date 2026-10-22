import "server-only";
import sharp from "sharp";

/** Brightness map stored on a generated image (asset.luma): the image is split
 * into an 8×8 grid in its own proportions, and each cell records the 98th
 * percentile of its pixels' brightest channel (0–255). Slides that set text
 * over the image size their scrim from the cells under the text, so text stays
 * at 4.5:1 or better however bright the picture is (compose-image.ts). */
export async function imageLuma(bytes: Buffer): Promise<number[]> {
  const size = 256, cell = size / 8;
  const { data } = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().removeAlpha().resize(size, size, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const out: number[] = [];
  for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 8; gx++) {
    const values: number[] = [];
    for (let y = gy * cell; y < (gy + 1) * cell; y++) for (let x = gx * cell; x < (gx + 1) * cell; x++) {
      const i = (y * size + x) * 3;
      values.push(Math.max(data[i], data[i + 1], data[i + 2]));
    }
    values.sort((a, b) => a - b);
    out.push(values[Math.min(values.length - 1, Math.floor(values.length * 0.98))]);
  }
  return out;
}

/** The darker counterpart of imageLuma: each 8×8 cell's 2nd-percentile darkest channel (0–255), so dark text set over
 * an image can be checked against its darkest pixels as light text is against its brightest. */
export async function imageShade(bytes: Buffer): Promise<number[]> {
  const size = 256, cell = size / 8;
  const { data } = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().removeAlpha().resize(size, size, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const out: number[] = [];
  for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 8; gx++) {
    const values: number[] = [];
    for (let y = gy * cell; y < (gy + 1) * cell; y++) for (let x = gx * cell; x < (gx + 1) * cell; x++) {
      const i = (y * size + x) * 3;
      values.push(Math.min(data[i], data[i + 1], data[i + 2]));
    }
    values.sort((a, b) => a - b);
    out.push(values[Math.floor(values.length * 0.02)]);
  }
  return out;
}
