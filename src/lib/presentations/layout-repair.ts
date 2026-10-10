import {ArtifactContentSchema} from "../domain";
import {SLIDE_CANVAS} from "./composition";
import type {inspectNativePresentation} from "../server/export";

type MeasuredReview = Pick<Awaited<ReturnType<typeof inspectNativePresentation>>, "slides">;
/** One conservative geometry repair using measurements from this exact candidate.
 * Never changes copy, typography, position, locked slides or other elements.
 * Caller must rerender and run the full acceptance checks afterwards. */
export function expandNativeTextBoxes(contentInput: unknown, review: MeasuredReview) {
  const content = ArtifactContentSchema.parse(contentInput);
  if (content.kind !== "presentation") throw new Error("PRESENTATION_REQUIRED");
  const adjustments: {sectionId:string;elementId:string;previousHeight:number;height:number}[] = [];
  for (const slide of review.slides) {
    const section = content.sections[slide.slide - 1], design = section?.slideDesign;
    if (!design || section.blocks.some(block => block.locked)) continue;
    for (const finding of slide.overflowingText) {
      const element = design.elements.find(element => element.id === finding.elementId);
      if (!element || element.kind !== "text" || Math.abs(element.width - finding.width) > 1
        || Math.abs(element.height - finding.height) > 1 || finding.requiredWidth > finding.width + 2
        || !Number.isFinite(finding.requiredHeight)) continue;
      const height = Math.ceil(finding.requiredHeight + 3);
      if (height <= element.height || height - element.height > 64 || element.y + height > SLIDE_CANVAS.height) continue;
      const collides = design.elements.some(other => other.id !== element.id
        && Math.min(element.x + element.width, other.x + other.width) > Math.max(element.x, other.x)
        && Math.min(element.y + height, other.y + other.height) > Math.max(element.y, other.y));
      if (collides) continue;
      adjustments.push({sectionId:section.id,elementId:element.id,previousHeight:element.height,height});
      element.height = height;
    }
  }
  return {content,adjustments};
}
