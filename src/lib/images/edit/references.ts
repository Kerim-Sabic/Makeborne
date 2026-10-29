import { RequestError } from "../../server/http";
import { ArtifactContentSchema, type ArtifactContent, type StyleProfile } from "../../domain";
import { projectDocument } from "../../documents/project";
import type { DocumentSource } from "../../documents/schema";
import type { EditReference } from "./contract";

/**
 * Where an asset is used, and the pure acceptance of an edit: build the next
 * version in which ONLY the chosen uses point at the edited asset. Every other
 * use, and the original asset itself, stay exactly as they were. The result is
 * saved by the caller with the expected-version check (makeborne_save_artifact_version).
 */
export type VersionParts = { content: ArtifactContent; style: StyleProfile; assetIds: string[] };
export type CandidateAsset = { id: string; sha256: string; bytes: number; mediaType: "image/webp" | "image/png" };
export type WebsiteAsset = { id: string; path: string; sha256: string; bytes: number; mediaType: "image/png" | "image/jpeg" | "image/webp" };
export type AssetUse = EditReference & { label: string };

const mismatch = () => new RequestError("EDIT_REFERENCE_MISMATCH", "One of the chosen places no longer shows this image. Reload the project and choose again.", 409);
const publicUrl = (path: string) => `/${path.slice("public/".length)}`;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Textual uses of a public URL: not followed by another path character (so /a.webp never matches /a.webp2). */
const urlPattern = (url: string) => new RegExp(`${escape(url)}(?![A-Za-z0-9_./-])`, "g");

/** Every place this asset is used in a version, as references the customer can pick. */
export function listAssetUses(parts: VersionParts, assetId: string): AssetUse[] {
  const id = assetId.toLowerCase(), uses: AssetUse[] = [];
  parts.content.sections.forEach((section, sectionIndex) => section.blocks.forEach((block, blockIndex) => {
    if (block.assetId?.toLowerCase() === id && !parts.content.document) uses.push({ kind: "block", sectionId: section.id, blockId: block.id, label: `Section ${sectionIndex + 1}, image ${blockIndex + 1}` });
  }));
  if (parts.style.referenceAssetIds.some(value => value.toLowerCase() === id)) uses.push({ kind: "style_reference", label: "Style reference" });
  const doc = parts.content.document;
  if (doc) {
    const names = new Set(doc.assets.filter(item => item.id.toLowerCase() === id).map(item => item.name));
    for (const name of names) uses.push({ kind: "document_asset", name, label: `Everywhere "${name}" is used` });
    if (names.size) for (const at of documentLocations(doc, names)) uses.push({ kind: "document_image", at, label: at.replace(/:/g, " ") });
  }
  const source = parts.content.websiteSource;
  if (source) for (const asset of source.assets.filter(item => item.id.toLowerCase() === id)) {
    uses.push({ kind: "website_asset", path: asset.path, label: `Everywhere ${publicUrl(asset.path)} is used` });
    for (const file of source.files) {
      const count = [...file.content.matchAll(urlPattern(publicUrl(asset.path)))].length;
      for (let occurrence = 0; occurrence < Math.min(count, 200); occurrence++) uses.push({ kind: "website_occurrence", path: asset.path, file: file.path, occurrence, label: `${file.path}, use ${occurrence + 1}` });
    }
  }
  return uses;
}

const FIGURE = /\[\[figure:\s*([a-z0-9][a-z0-9-]{1,48})\s*(?=\||\]\])/g;
function documentLocations(doc: DocumentSource, names: ReadonlySet<string>): string[] {
  const at: string[] = [], has = (name?: string) => name !== undefined && names.has(name);
  if (doc.kind === "deck") for (const slide of doc.slides) {
    if (has(slide.image)) at.push(`slide:${slide.id}`);
    slide.people?.forEach((person, index) => { if (has(person.image)) at.push(`slide:${slide.id}:person:${index}`); });
  } else {
    if (has(doc.cover.image)) at.push("cover");
    for (const chapter of doc.chapters) {
      if (has(chapter.image)) at.push(`chapter:${chapter.id}`);
      const figures = [...chapter.text.matchAll(FIGURE)].filter(match => names.has(match[1])).length;
      for (let index = 0; index < Math.min(figures, 50); index++) at.push(`chapter:${chapter.id}:figure:${index}`);
    }
  }
  return at;
}

/** A new, unique image name for one switched document placement. */
function editedName(doc: DocumentSource, name: string, sha256: string) {
  const base = `${name.slice(0, 40).replace(/-+$/, "")}-e${sha256.slice(0, 6)}`;
  let candidate = base, n = 2;
  while (doc.assets.some(asset => asset.name === candidate)) candidate = `${base.slice(0, 46)}${n++}`;
  return candidate;
}
/** A new website path for the edited bytes, beside the original. */
function editedPath(source: NonNullable<ArtifactContent["websiteSource"]>, path: string, candidate: CandidateAsset) {
  const directory = path.slice(0, path.lastIndexOf("/") + 1), file = path.slice(path.lastIndexOf("/") + 1);
  const stem = file.replace(/\.[^.]+$/, "").slice(0, 60);
  const extension = candidate.mediaType === "image/png" ? "png" : "webp";
  const existing = source.assets.find(asset => asset.id === candidate.id);
  if (existing) return existing.path; // accepted before (idempotent)
  let next = `${directory}${stem}-edit-${candidate.sha256.slice(0, 8)}.${extension}`, n = 2;
  const taken = new Set([...source.files, ...source.assets].map(item => item.path.toLowerCase()));
  while (taken.has(next.toLowerCase())) next = `${directory}${stem}-edit-${candidate.sha256.slice(0, 8)}-${n++}.${extension}`;
  return next;
}

/**
 * The next version's content, style and manifest. Throws when a chosen
 * reference does not currently show the original (stale choice). Website
 * variants are the edited image's responsive copies (already registered).
 */
export function applyAcceptedEdit(parts: VersionParts, input: { originalId: string; candidate: CandidateAsset; references: readonly EditReference[]; variants?: readonly WebsiteAsset[] }): VersionParts & { switched: number } {
  const original = input.originalId.toLowerCase(), candidate = input.candidate;
  const content: ArtifactContent = structuredClone(parts.content), style: StyleProfile = structuredClone(parts.style);
  const added = new Set<string>([candidate.id]);
  let switched = 0;
  const keys = new Set(input.references.map(reference => JSON.stringify(reference)));
  if (keys.size !== input.references.length) throw new RequestError("EDIT_REFERENCE_DUPLICATE", "Each place can be chosen once.");

  // Numbered uses refer to the version as the customer saw it: switch later ones first so earlier numbers stay valid.
  const rank = (reference: EditReference) => reference.kind === "website_occurrence" ? reference.occurrence : reference.kind === "document_image" && reference.at.includes(":figure:") ? Number(reference.at.split(":")[3]) : -1;
  const ordered = [...input.references].sort((a, b) => rank(b) - rank(a));
  // Whole-path switches run after single uses, so they never renumber them.
  ordered.sort((a, b) => Number(a.kind === "website_asset") - Number(b.kind === "website_asset"));
  for (const reference of ordered) {
    if (reference.kind === "block") {
      if (content.document) throw mismatch();
      const block = content.sections.find(section => section.id === reference.sectionId)?.blocks.find(item => item.id === reference.blockId);
      if (!block || block.assetId?.toLowerCase() !== original) throw mismatch();
      block.assetId = candidate.id; switched++;
    } else if (reference.kind === "style_reference") {
      const index = style.referenceAssetIds.findIndex(value => value.toLowerCase() === original);
      if (index < 0) throw mismatch();
      style.referenceAssetIds[index] = candidate.id; switched++;
    } else if (reference.kind === "document_asset" || reference.kind === "document_image") {
      const doc = content.document;
      if (!doc) throw mismatch();
      if (reference.kind === "document_asset") {
        const asset = doc.assets.find(item => item.name === reference.name);
        if (!asset || asset.id.toLowerCase() !== original) throw mismatch();
        asset.id = candidate.id; switched++;
        continue;
      }
      const [where, id, part, index] = reference.at.split(":");
      const current = (name: string | undefined) => name ? doc.assets.find(asset => asset.name === name) : undefined;
      // One placement: a new image entry for the edited bytes, used only here.
      const swap = (name: string | undefined, set: (next: string) => void) => {
        const asset = current(name);
        if (!asset || asset.id.toLowerCase() !== original) throw mismatch();
        const reuse = doc.assets.find(item => item.id === candidate.id && item.aspect === asset.aspect);
        const next = reuse?.name ?? editedName(doc, asset.name, candidate.sha256);
        if (!reuse) doc.assets.push({ ...asset, name: next, id: candidate.id });
        set(next); switched++;
      };
      if (doc.kind === "deck") {
        const slide = doc.slides.find(item => item.id === id);
        if (where !== "slide" || !slide) throw mismatch();
        if (part === "person") { const person = slide.people?.[Number(index)]; if (!person) throw mismatch(); swap(person.image, next => { person.image = next; }); }
        else swap(slide.image, next => { slide.image = next; });
      } else if (where === "cover") swap(doc.cover.image, next => { doc.cover.image = next; });
      else {
        const chapter = doc.chapters.find(item => item.id === id);
        if (where !== "chapter" || !chapter) throw mismatch();
        if (part === "figure") {
          // The nth figure (text order) whose image is the original, under any of its names.
          const names = new Set(doc.assets.filter(asset => asset.id.toLowerCase() === original).map(asset => asset.name));
          const target = Number(index);
          const hit = [...chapter.text.matchAll(FIGURE)].filter(match => names.has(match[1]))[target];
          if (!hit || hit.index === undefined) throw mismatch();
          const name = hit[1], at = hit.index;
          swap(name, next => { chapter.text = chapter.text.slice(0, at) + hit[0].replace(name, next) + chapter.text.slice(at + hit[0].length); });
        } else swap(chapter.image, next => { chapter.image = next; });
      }
    } else {
      const source = content.websiteSource;
      const asset = source?.assets.find(item => item.path === reference.path);
      if (!source || !asset || asset.id.toLowerCase() !== original) throw mismatch();
      const path = editedPath(source, reference.path, candidate);
      if (!source.assets.some(item => item.id === candidate.id)) source.assets.push({ id: candidate.id, path, sha256: candidate.sha256, bytes: candidate.bytes, mediaType: candidate.mediaType });
      for (const variant of input.variants ?? []) if (!source.assets.some(item => item.path === variant.path)) { source.assets.push({ ...variant }); added.add(variant.id); }
      const from = urlPattern(publicUrl(reference.path)), to = publicUrl(path);
      if (reference.kind === "website_asset") {
        let count = 0;
        for (const file of source.files) file.content = file.content.replace(from, () => { count++; return to; });
        if (!count) throw mismatch();
        switched += count;
      } else {
        const file = source.files.find(item => item.path === reference.file);
        if (!file) throw mismatch();
        let seen = -1, hit = false;
        file.content = file.content.replace(from, found => (++seen === reference.occurrence ? (hit = true, to) : found));
        if (!hit) throw mismatch();
        switched++;
      }
    }
  }
  if (content.document) content.sections = projectDocument(content.document);
  // The manifest only grows: the original stays listed (other uses and history keep it), the edit is added.
  const assetIds = [...new Set([...parts.assetIds.map(value => value.toLowerCase()), ...added, ...(content.document?.assets.map(asset => asset.id) ?? [])])];
  const parsed = ArtifactContentSchema.safeParse(content);
  if (!parsed.success) throw new RequestError("EDIT_RESULT_INVALID", "The edited project could not be saved in a valid shape. Nothing was changed.", 409);
  return { content: parsed.data, style, assetIds, switched };
}
