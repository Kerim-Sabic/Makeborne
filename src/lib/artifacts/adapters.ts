import { z } from "zod";
import { ArtifactContentSchema, type ArtifactContent } from "../domain";
import {
  ArtifactSpecSchema, BookSpecSchema, DeckSpecSchema, SiteSpecSchema,
  type ArtifactSpec, type AssetReference,
  ProjectContextSchema, type ProjectContext,
} from "./schemas";

const localBlock = z.object({
  id: z.string().uuid(), type: z.enum(["heading", "paragraph", "image", "quote"]),
  text: z.string().max(50000),
  image: z.string().max(4100000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).optional(),
});
const localInput = z.object({
  id: z.string().uuid(), title: z.string().min(1).max(200),
  kind: z.enum(["website", "book", "presentation"]), styleId: z.string().min(1).max(100),
  blocks: z.array(localBlock).max(500),
});
export type ManualProjectInput = z.input<typeof localInput>;
export type PendingInlineAsset = { id: string; dataUrl: string; origin: "uploaded" };
export type AdaptedArtifact = { spec: ArtifactSpec; pendingAssets: PendingInlineAsset[]; warnings: string[] };

/** Stable custom UUIDv8 derived from an existing element, not a security identifier. */
export function derivedElementId(namespace: string, originalId: string): string {
  const seed = `${namespace}:${originalId}`;
  const parts = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].map((offset) => {
    let hash = offset;
    for (let index = 0; index < seed.length; index++) { hash ^= seed.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
    return (hash >>> 0).toString(16).padStart(8, "0");
  });
  const value = parts.join("");
  return `${value.slice(0,8)}-${value.slice(8,12)}-8${value.slice(13,16)}-a${value.slice(17,20)}-${value.slice(20,32)}`;
}

/** Converts current flat local editor blocks without implying generated output. */
export function fromLocalProject(input: ManualProjectInput): AdaptedArtifact {
  const project = localInput.parse(input);
  const assets: AssetReference[] = [];
  const pendingAssets: PendingInlineAsset[] = [];
  const warnings = ["This adapter preserves authored local content; it does not generate artwork, publish a site or verify a print edition."];
  const seen = new Set<string>();
  const blocks = project.blocks.map((block) => {
    if (seen.has(block.id)) throw new Error("Local block IDs must be unique.");
    seen.add(block.id);
    let assetId: string | null = null;
    if (block.type === "image" && block.image) {
      assetId = derivedElementId("asset", block.id);
      const mime = block.image.slice(5, block.image.indexOf(";")) as AssetReference["mime"];
      assets.push({ id: assetId, mime, origin: "uploaded", state: "pending_upload", alt: block.text, sourceIds: [] });
      pendingAssets.push({ id: assetId, dataUrl: block.image, origin: "uploaded" });
    } else if (block.type === "image") warnings.push(`Image block ${block.id} has no image bytes.`);
    return { id: block.id, type: block.type, text: block.text, assetId, locked: false, sourceIds: [] };
  });
  if (pendingAssets.length) warnings.push("Inline images need an authorised upload before cloud rendering; their bytes stay outside the declarative spec.");
  const common = { schemaVersion: 1 as const, id: project.id, title: project.title, styleRef: { id: project.styleId, version: 1 }, language: "en", sourceIds: [], assets, authorship: "authored" as const };
  const containerId = derivedElementId("section", project.id);
  let spec: ArtifactSpec;
  if (project.kind === "website") {
    spec = SiteSpecSchema.parse({ ...common, kind: "website", navigation: [], pages: [{ id: derivedElementId("page", project.id), path: "/", title: project.title, description: "", sections: [{ id: containerId, type: "content", anchor: "content", heading: project.title, responsive: { desktopColumns: 1, mobileColumns: 1, imagePlacement: "none" }, sourceIds: [], blocks }] }] });
    warnings.push("Flat content is represented as a content section. It has not been inferred into business claims, testimonials or form integrations.");
  } else if (project.kind === "book") {
    spec = BookSpecSchema.parse({ ...common, kind: "book", subtitle: "", coverAssetId: null, chapters: [{ id: containerId, title: project.title, body: blocks, artworkAssetIds: assets.map((asset) => asset.id), sourceIds: [] }], editions: [{ id: derivedElementId("edition", project.id), type: "digital_pdf", pageSize: "a4", navigation: true }] });
  } else {
    warnings.push("Existing manual slides are explicitly native mode. They are not OpenAI-generated full slide images.");
    const groups = blocks.length ? blocks.map((block) => [block]) : [[]];
    spec = DeckSpecSchema.parse({ ...common, kind: "presentation", mode: "native", aspect: "16:9", slides: groups.map((group, index) => {
      const first = group[0];
      const basis = first?.id ?? project.id;
      const slideTitle = first?.type === "heading" && first.text.trim() ? first.text.slice(0,200) : index === 0 ? project.title : `Slide ${index + 1}`;
      return { id: derivedElementId("slide", basis), title: slideTitle, script: group, notes: "", sourceIds: [], visualAssetId: null, textCheck: "not_checked", elements: first ? first.assetId ? [{ id: derivedElementId("native", basis), type: "image", x: 0.06, y: 0.12, width: 0.88, height: 0.76, assetId: first.assetId, fit: "contain", sourceIds: [] }] : first.type === "image" ? [] : [{ id: derivedElementId("native", basis), type: "text", x: 0.06, y: 0.12, width: 0.88, height: 0.76, text: first.text, role: first.type === "heading" ? "title" : "body", font: project.styleId === "editorial" ? "serif" : "sans", fontSizePt: first.type === "heading" ? 32 : 20, color: "#16181D", sourceIds: [] }] : [] };
    }) });
  }
  return { spec, pendingAssets, warnings };
}

/** Cloud domain blocks remain the canonical body; no free-form HTML conversion. */
export function fromCloudContent(contentInput: ArtifactContent, artifactId: string, styleRef: { id: string; version: number }, assets: AssetReference[] = []): AdaptedArtifact {
  const content = ArtifactContentSchema.parse(contentInput);
  const sourceIds = [...new Set(content.sections.flatMap((section) => section.blocks.flatMap((block) => block.sourceIds)))];
  const common = { schemaVersion: 1 as const, id: artifactId, title: content.title, styleRef, language: "en", sourceIds, assets, authorship: "authored" as const };
  const sections = content.sections.length ? content.sections : [{ id: derivedElementId("empty-section", artifactId), title: content.title, blocks: [] }];
  const warnings = ["Cloud content conversion preserves declared references; it does not verify source rights or evidence accuracy."];
  let spec: ArtifactSpec;
  if (content.kind === "website") {
    spec = SiteSpecSchema.parse({ ...common, kind: "website", pages: [{ id: derivedElementId("page", artifactId), path: "/", title: content.title, description: "", sections: sections.map((section, index) => ({ id: section.id, type: "content", anchor: `section-${index + 1}`, heading: section.title || content.title, blocks: section.blocks, responsive: { desktopColumns: 1, mobileColumns: 1, imagePlacement: "none" }, sourceIds: [...new Set(section.blocks.flatMap((block) => block.sourceIds))] })) }] });
  } else if (content.kind === "book") {
    spec = BookSpecSchema.parse({ ...common, kind: "book", chapters: sections.map((section) => ({ id: section.id, title: section.title || content.title, body: section.blocks, artworkAssetIds: section.blocks.flatMap((block) => block.assetId ? [block.assetId] : []), sourceIds: [...new Set(section.blocks.flatMap((block) => block.sourceIds))] })), editions: [{ id: derivedElementId("edition", artifactId), type: "digital_pdf", pageSize: "a4", navigation: true }] });
  } else {
    spec = DeckSpecSchema.parse({ ...common, kind: "presentation", mode: "native", slides: sections.map((section) => ({ id: section.id, title: section.title || content.title, script: section.blocks, sourceIds: [...new Set(section.blocks.flatMap((block) => block.sourceIds))], elements: [] })) });
    warnings.push("Cloud native content needs a layout pass before export; this adapter does not manufacture editable chart objects from prose.");
  }
  return { spec, pendingAssets: [], warnings };
}

export function normalizeArtifactSpec(input: unknown): ArtifactSpec {
  // Parse/validate only: do not silently rewrite content or invent references.
  return ArtifactSpecSchema.parse(input);
}

export function exportReadiness(input: ArtifactSpec): { ready: boolean; findings: string[] } {
  const spec = normalizeArtifactSpec(input);
  const findings: string[] = [];
  if (spec.assets.some((asset) => asset.state !== "available")) findings.push("Some declared assets are not available.");
  if (spec.kind === "presentation") {
    if (spec.mode === "visual") {
      if (spec.slides.some((slide) => !slide.visualAssetId)) findings.push("Some full visual slide images are missing.");
      if (spec.slides.some((slide) => slide.textCheck !== "passed")) findings.push("Generated slide text has not passed its declared check.");
      if (["generated", "mixed"].includes(spec.authorship) && spec.slides.some((slide) => !spec.assets.some((asset) => asset.id === slide.visualAssetId && asset.origin === "openai_generated"))) findings.push("Generated visual slides require genuine OpenAI full-slide assets.");
    } else if (spec.slides.some((slide) => !slide.elements.length)) findings.push("Some native slides have no renderable native elements.");
  }
  if (spec.kind === "book") {
    if (["generated", "mixed"].includes(spec.authorship) && !spec.assets.some((asset) => asset.origin === "openai_generated" && asset.state === "available")) findings.push("Generated books require genuine available OpenAI artwork.");
    if (spec.editions.some((edition) => edition.type === "print" && (edition.preflightState !== "passed" || !edition.preflightReportId))) findings.push("A print edition needs an actual preflight report.");
    if (spec.editions.some((edition) => edition.type === "epub" && (edition.validationState !== "passed" || !edition.validationReportId))) findings.push("An EPUB edition needs an actual validation report.");
  }
  return { ready: !findings.length, findings };
}

/** A structural rights checklist; callers must load context from authorised storage. */
export function publicationReadiness(input: ArtifactSpec, contextInput: ProjectContext): { ready: boolean; findings: string[] } {
  const spec = normalizeArtifactSpec(input);
  const context = ProjectContextSchema.parse(contextInput);
  const findings: string[] = [];
  const usedIds = new Set(spec.sourceIds);
  for (const id of usedIds) {
    const source = context.sources.find((item) => item.id === id);
    if (!source) findings.push(`Source ${id} is absent from the authorised project context.`);
    else if (!source.processingAllowed || !source.publicationAllowed || source.rightsBasis === "unknown") findings.push(`Source ${id} does not have declared processing and publication rights.`);
  }
  if (spec.kind === "website") {
    for (const page of spec.pages) for (const section of page.sections) if (section.type === "testimonials") for (const testimonial of section.items) {
      if (!testimonial.sourceIds.some((id) => context.facts.some((fact) => fact.state === "approved" && fact.sourceIds.includes(id)))) findings.push(`Testimonial ${testimonial.id} lacks an approved evidence record.`);
    }
  }
  return { ready: !findings.length, findings };
}
