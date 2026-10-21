import type { ArtifactContent } from "../domain";
import { fallbackProjectTitle, isPlaceholderTitle, type TitleKind } from "./project-title";

/**
 * Renaming a saved project from the library.
 *
 * What a library card names is the artifact title (`public.artifacts.title`),
 * the same title the editor's heading, title search and the Title sort use. The
 * database copies it from the saved content whenever a version is saved
 * (`makeborne_save_artifact_version`) and nothing else writes it, so a rename is
 * a version save of the current content with only `content.title` changed,
 * through the existing authorized route with its `expectedVersion` conflict
 * guard. `projects.title` (PATCH …/projects/[id]) is a different field that no
 * library card shows, so changing it would not rename what the user sees.
 *
 * Names are never changed without the user confirming the exact text. For a
 * project still called "Untitled …", suggestions come only from content the
 * account can already read: the title inside the current version's book or
 * deck, the brief-derived title Makeborne would give it today, and the
 * project's own record title. A deliberate name gets no suggestions.
 * Client-safe; no dependencies.
 */
export const RENAME_MAX = 200;

export type RenameCheck = { ok: true; name: string } | { ok: false; reason: "empty" | "too-long" | "unchanged" };
export function checkRename(input: string, current: string): RenameCheck {
  const name = input.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, reason: "empty" };
  if (name.length > RENAME_MAX) return { ok: false, reason: "too-long" };
  if (name === current.trim()) return { ok: false, reason: "unchanged" };
  return { ok: true, name };
}
export const RENAME_REASON: Record<Exclude<RenameCheck, { ok: true }>["reason"], string> = {
  empty: "Enter a name.", "too-long": `Use ${RENAME_MAX} characters or fewer.`, unchanged: "This is already the project’s name.",
};

/** Suggested names for a placeholder title, best first, without duplicates or placeholders. */
export function renameSuggestions(current: string, kind: TitleKind, sources: { documentTitle?: string | null; brief?: string | null; projectTitle?: string | null }): string[] {
  if (!isPlaceholderTitle(current)) return [];
  const candidates = [sources.documentTitle, sources.brief ? fallbackProjectTitle(sources.brief, kind) : null, sources.projectTitle];
  const seen = new Set<string>(), out: string[] = [];
  for (const raw of candidates) {
    const name = raw?.replace(/\s+/g, " ").trim().slice(0, RENAME_MAX);
    if (!name || isPlaceholderTitle(name) || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase()); out.push(name);
  }
  return out.slice(0, 3);
}

/** The saved content with only its title changed; every other field, including a document's own cover title, is kept. */
export function renamedContent(content: ArtifactContent, name: string): ArtifactContent {
  return { ...content, title: name };
}

/** Change summary recorded on the version the rename saves. */
export const renameSummary = (name: string) => `Renamed to “${name}”`;

/** What a rename tells the user about its effect, per format. `ownDocumentTitle`: a book or deck whose cover or slides carry their own title. */
export function renameEffect(kind: TitleKind, nextVersion: number, ownDocumentTitle: boolean): string {
  const base = `Saves Version ${nextVersion} with the new name. Nothing else in the project changes.`;
  if (kind === "website") return `${base} This name is also the website’s default title in browser tabs and search results; a live site shows it after you publish again.`;
  if (ownDocumentTitle) return `${base} The ${kind === "book" ? "cover keeps the title written on it" : "slides keep the title written on them"}.`;
  return base;
}

export type RenameFailure = { message: string; conflict: boolean };
/** Honest failure text: a conflict asks for a refresh, an unconfirmed save says so, anything else keeps the old name. */
export function renameFailure(error: unknown): RenameFailure {
  const status = typeof error === "object" && error !== null && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : null;
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  const uncertain = typeof error === "object" && error !== null && (error as { uncertain?: unknown }).uncertain === true;
  if (code === "ACCOUNT_CHANGED" || code === "REQUEST_PENDING" || uncertain) return { message: error instanceof Error ? error.message : "The rename couldn’t be confirmed. Refresh before trying again.", conflict: false };
  if (status === 409) return { message: "This project was saved again since the library loaded, so it wasn’t renamed. Refresh the library and try again.", conflict: true };
  if (status === 403 || status === 404) return { message: "This project is no longer available to your account, so it wasn’t renamed.", conflict: false };
  return { message: `${error instanceof Error && error.message ? error.message.replace(/\.?$/, ".") : "The rename couldn’t be saved."} The project keeps its current name.`, conflict: false };
}
