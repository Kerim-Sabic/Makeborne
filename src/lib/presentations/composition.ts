/** Shared native slide geometry. No source rewriting, remote assets or code execution. */
export const SLIDE_CANVAS = {width: 1280, height: 720} as const;
type SourceBlock = {id: string; type: string; text: string};
export function groupPresentationBlocks<T extends SourceBlock>(title: string, blocks: readonly T[]) {
  const slides: {id: string; title: string; blocks: T[]}[] = [];
  for (const block of blocks) {
    if (block.type === "heading") slides.push({id: block.id, title: block.text, blocks: []});
    else {
      if (!slides.length) slides.push({id: block.id, title, blocks: []});
      let current = slides[slides.length - 1];
      // Each image retains its own composition and caption; no artwork is overwritten.
      if (block.type === "image" && current.blocks.some(value => value.type === "image")) {
        current = {id: block.id, title: current.title, blocks: []};
        slides.push(current);
      }
      current.blocks.push(block);
    }
  }
  return slides.length ? slides : [{id: "title", title, blocks: []}];
}
export type SlideCopy = {title: string; body: string; hasImage: boolean};
export type SlideBox = {x: number; y: number; width: number; height: number};
export type SlideTextBox = SlideBox & {kind: "title" | "body" | "folio"; text: string; fontSize: number; lineHeight: number};
export type NativeSlideComposition = {
  layout: "opening" | "statement" | "image-led" | "editorial";
  text: SlideTextBox[];
  image?: SlideBox;
};
export function composeNativeSlide(copy: SlideCopy, index: number, total: number): NativeSlideComposition {
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index >= total) throw new Error("INVALID_SLIDE_POSITION");
  const layout = copy.hasImage ? "image-led" : index === 0 && copy.title.length <= 110 && copy.body.length <= 240 ? "opening" : copy.title.length <= 90 && copy.body.length <= 180 ? "statement" : "editorial";
  const title: SlideTextBox = {kind: "title", text: copy.title, x: 72, y: 76, width: 1136, height: 244, fontSize: 64, lineHeight: 1.12};
  const body: SlideTextBox = {kind: "body", text: copy.body, x: 72, y: 350, width: 1136, height: 270, fontSize: 28, lineHeight: 1.45};
  let image: SlideBox | undefined;
  if (layout === "opening") {
    Object.assign(title, {y: 132, width: 1100, height: 300, fontSize: 88});
    Object.assign(body, {y: 466, width: 960, height: 152});
  } else if (layout === "statement") {
    Object.assign(title, {y: 132, width: 1100, height: 300, fontSize: 80});
    Object.assign(body, {y: 464, width: 1000, height: 156, fontSize: 30});
  } else if (layout === "image-led") {
    Object.assign(title, {y: 90, width: 528, height: 238, fontSize: 58});
    Object.assign(body, {y: 360, width: 528, height: 260, fontSize: 26});
    image = {x: 672, y: 72, width: 536, height: 548};
  } else {
    Object.assign(title, {y: 84, width: 440, height: 510, fontSize: 54});
    Object.assign(body, {x: 584, y: 90, width: 624, height: 530, fontSize: 26});
  }
  return {layout, text: [title, ...(copy.body ? [body] : []), {kind: "folio", text: `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, x: 1096, y: 664, width: 112, height: 24, fontSize: 13, lineHeight: 1.2}], ...(image ? {image} : {})};
}
export function slideBoxPercent(box: SlideBox) {
  return {left: `${box.x / SLIDE_CANVAS.width * 100}%`, top: `${box.y / SLIDE_CANVAS.height * 100}%`, width: `${box.width / SLIDE_CANVAS.width * 100}%`, height: `${box.height / SLIDE_CANVAS.height * 100}%`};
}
