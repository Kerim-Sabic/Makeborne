import {WebsiteProjectSourceSchema, type WebsiteProjectSource} from "./website-source";

/** The sandbox toolchain is pinned on the server. Customer code is never executed here. */
export function managedSourcePath(path: string): boolean {
  return /^(?:package(?:-lock)?\.json|(?:vite|postcss|tailwind)\.config\.[^/]+)$/i.test(path);
}
export function removableSourcePath(source: WebsiteProjectSource, path: string): boolean {
  return !managedSourcePath(path) && path !== "index.html" && path !== source.entrypoint;
}
type Edit = {type: "edit"; path: string; content: string} | {type: "add"; path: string} | {type: "remove"; path: string};
export type SourceEditResult = {ok: true; source: WebsiteProjectSource} | {ok: false; message: string};
export function editWebsiteSource(source: WebsiteProjectSource, edit: Edit): SourceEditResult {
  if (managedSourcePath(edit.path)) return {ok: false, message: "This file is managed by Makeborne’s build environment."};
  const exists = source.files.some(file => file.path === edit.path);
  if (edit.type === "add" && source.files.some(file => file.path.toLowerCase() === edit.path.toLowerCase())) return {ok: false, message: "A file already uses this path."};
  if (edit.type !== "add" && !exists) return {ok: false, message: "This file is no longer in the project."};
  if (edit.type === "remove" && !removableSourcePath(source, edit.path)) return {ok: false, message: "The project needs this file to build."};
  const files = edit.type === "add" ? [...source.files, {path: edit.path, content: ""}]
    : edit.type === "remove" ? source.files.filter(file => file.path !== edit.path)
    : source.files.map(file => file.path === edit.path ? {...file, content: edit.content} : file);
  const parsed = WebsiteProjectSourceSchema.safeParse({...source, files});
  return parsed.success ? {ok: true, source: parsed.data} : {ok: false, message: parsed.error.issues[0]?.message ?? "This change exceeds the project’s source limits."};
}
