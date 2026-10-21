import type { ArtifactContent } from "../domain";

/**
 * How a saved version stores its content. Builder versions keep a document
 * (books, decks) or a source project (websites). Earlier versions, and text
 * supplied when a project is created, keep outline sections; older websites
 * may keep a static design. Those stay readable and exportable as they are and
 * are converted only by an explicit build, which saves a new version and
 * leaves this one in history.
 */
export type SavedFormat = "document" | "website-source" | "website-design" | "outline" | "starting";

const PLACEHOLDER_SECTION_TITLES = new Set(["", "Main content"]);

export function savedFormat(content: ArtifactContent, version: number): SavedFormat {
  if (content.kind === "website" ? content.websiteSource : content.document) return content.kind === "website" ? "website-source" : "document";
  if (content.kind === "website" && content.website) return "website-design";
  const blocks = content.sections.flatMap(section => section.blocks);
  const titled = content.sections.some(section => !PLACEHOLDER_SECTION_TITLES.has(section.title.trim()) && section.title !== content.title);
  // A new project is saved with its title as the only heading.
  const titleOnly = version <= 1 && blocks.length === 1 && blocks[0].type === "heading" && blocks[0].text === content.title && !blocks[0].assetId;
  return !titled && (!blocks.length || titleOnly) ? "starting" : "outline";
}

/** Builder output exists: a new build edits it rather than starting over. */
export const hasBuilderSource = (format: SavedFormat | null) => format === "document" || format === "website-source";

export type PreviewChoice =
  /** Output streaming from the live builder. */
  | "live"
  /** The saved builder document or website source. */
  | "document" | "website-source"
  /** A website revision made by the earlier generation worker. */
  | "generated-website"
  /** Saved outline content or a static website design, shown by the outline renderer. */
  | "outline"
  /** Nothing saved yet: invite the first build, or the first edit when no build can start. */
  | "start-builder" | "start-draft";

/**
 * Picks the preview from what is saved, never from whether generation is
 * offered: turning the builder on or off must not hide saved work.
 * `builder`: the live builder is shown; `canBuild`: it can start work now.
 */
export function choosePreview(input: {
  kind: ArtifactContent["kind"]; format: SavedFormat; builder: boolean; canBuild: boolean;
  live: { document?: unknown } | null; generatedVersion: boolean;
}): PreviewChoice {
  const { kind, format, builder, live } = input;
  if (builder && live && (kind === "website" || live.document)) return "live";
  if (format === "document" || format === "website-source") return format;
  if (!builder && kind === "website" && input.generatedVersion) return "generated-website";
  if (format === "outline" || format === "website-design") return "outline";
  return builder && input.canBuild ? "start-builder" : "start-draft";
}

/**
 * The editor tab for a saved version and what the format notice may promise
 * about it. The toolbar label and the notice both come from here, so the notice
 * never names a control that isn't on screen. Websites with HTML/CSS or a source
 * project open in "Code"; outlines and documents open in "Edit". Reviewers can
 * read and download but not change content.
 */
export function editorEntry(content: Pick<ArtifactContent, "kind" | "website" | "websiteSource">, reviewer: boolean) {
  const label = content.kind === "website" && (content.website || content.websiteSource) ? "Code" as const : "Edit" as const;
  const action = reviewer ? "read it" : "read and edit it as it is";
  // Source projects download from the More menu; static designs and outlines from the editor tab itself.
  const download = content.websiteSource ? "" : reviewer ? ", and download a copy there" : ", and download a copy of the draft there";
  return { label, canEdit: !reviewer, instruction: `You can ${action} from the ${label} tab${download}.` };
}
