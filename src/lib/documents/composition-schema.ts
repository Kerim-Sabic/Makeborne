import { z } from "zod";

export const CompositionColorSchema = z.enum(["background", "surface", "ink", "muted", "accent", "accent2", "dark"]);
const coordinate = z.number().finite().min(0).max(100);
const box = { x: coordinate, y: coordinate, w: z.number().finite().min(1).max(100), h: z.number().finite().min(1).max(100) };
const TextElement = z.object({
  type: z.literal("text"), ...box,
  role: z.enum(["title", "subtitle", "eyebrow", "body", "author"]),
  font: z.enum(["heading", "body"]),
  size: z.number().finite().min(2.2).max(20).describe("Font size as percent of the canvas's shorter edge; title at least 4. Text may shrink to fit but never below its reading floor."),
  color: CompositionColorSchema,
  align: z.enum(["left", "center", "right"]).default("left"),
  weight: z.union([z.literal(400), z.literal(600), z.literal(700)]).default(400),
  italic: z.boolean().default(false),
}).strict();
const RectElement = z.object({ type: z.literal("rect"), ...box, fill: CompositionColorSchema, radius: z.number().finite().min(0).max(5).default(0) }).strict();
const EllipseElement = z.object({ type: z.literal("ellipse"), ...box, fill: CompositionColorSchema }).strict();
const LineElement = z.object({ type: z.literal("line"), x1: coordinate, y1: coordinate, x2: coordinate, y2: coordinate, color: CompositionColorSchema, width: z.number().finite().min(0.1).max(2) }).strict();
const ImageElement = z.object({ type: z.literal("image"), ...box }).strict().describe("Center-cropped frame for the existing cover/slide image. No URL or image text; use the registered image field and editable text roles.");
export const CoverCompositionSchema = z.object({
  version: z.literal(1),
  background: CompositionColorSchema,
  elements: z.array(z.discriminatedUnion("type", [TextElement, RectElement, EllipseElement, LineElement, ImageElement])).min(1).max(32),
}).strict().superRefine((composition, ctx) => {
  const roles = new Set<string>();
  let images = 0;
  const issue = (index: number, message: string) => ctx.addIssue({ code: "custom", path: ["elements", index], message });
  composition.elements.forEach((element, index) => {
    if (element.type === "line") {
      // Stroke widths are measured on the shorter canvas edge. This conservative
      // inset also keeps diagonal line caps inside either supported aspect ratio.
      const inset = element.width / 2;
      if ([element.x1, element.y1, element.x2, element.y2].some(value => value < inset || value > 100 - inset)) issue(index, "Line strokes must stay fully inside the canvas.");
      if (element.x1 === element.x2 && element.y1 === element.y2) issue(index, "A line needs two distinct endpoints.");
      return;
    }
    if (element.x + element.w > 100 || element.y + element.h > 100) issue(index, "The entire element must fit within the 0–100 canvas.");
    if (element.type === "image") images++;
    if (element.type === "text") {
      if (element.x < 4 || element.y < 4 || element.x + element.w > 96 || element.y + element.h > 96) issue(index, "Text needs a 4% safe margin on every side.");
      if (element.role === "title" && element.size < 4) issue(index, "The title must use at least 4% type.");
      if (roles.has(element.role)) issue(index, `Use the ${element.role} text role only once.`);
      roles.add(element.role);
    }
  });
  if (!roles.has("title")) ctx.addIssue({ code: "custom", path: ["elements"], message: "An authored cover or closing needs exactly one editable title." });
  if (images > 1) ctx.addIssue({ code: "custom", path: ["elements"], message: "Use at most one frame for the existing image." });
  const texts = composition.elements.filter(element => element.type === "text");
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j];
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)
      ctx.addIssue({ code: "custom", path: ["elements"], message: `The ${a.role} and ${b.role} text boxes overlap.` });
  }
});
export type CoverComposition = z.infer<typeof CoverCompositionSchema>;
