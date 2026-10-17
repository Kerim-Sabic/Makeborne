/**
 * Client-editable content for generated websites. The builder declares
 * collections (menu, hours, news…) in src/content/collections.json and keeps
 * their data in src/content/<name>.json; components import the JSON and render
 * values as text, validated links or project images. The client portal edits
 * only those data files, validated here against the manifest.
 *
 * Client-safe and dependency-light: used by the portal forms, the server
 * routes and the builder's static checks (ProjectFiles.problems()).
 */
import { z } from "zod";

export const CONTENT_DIR = "src/content/";
export const MANIFEST_PATH = "src/content/collections.json";
export const CONTENT_LIMITS = { fileBytes: 200_000, totalBytes: 600_000, maxItems: 200, collections: 30, fields: 40 } as const;
export const collectionPath = (name: string) => `${CONTENT_DIR}${name}.json`;

const COLLECTION_NAME = /^[a-z][a-z0-9-]{0,39}$/;
const FIELD_NAME = /^[a-z][A-Za-z0-9_]{0,39}$/;
const RESERVED = new Set(["__proto__", "constructor", "prototype", "collections"]);
const name = (pattern: RegExp) => z.string().regex(pattern).refine(value => !RESERVED.has(value), "Reserved name.");
const label = z.string().trim().min(1).max(60).regex(/^[^<>]*$/);

const base = { label: label.optional(), required: z.boolean().optional(), help: z.string().max(160).regex(/^[^<>]*$/).optional() };
export const FieldSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), ...base, multiline: z.boolean().optional(), max: z.number().int().min(1).max(4000).optional() }).strict(),
  z.object({ type: z.literal("richtext"), ...base, max: z.number().int().min(1).max(20000).optional() }).strict(),
  z.object({ type: z.literal("number"), ...base, min: z.number().optional(), max: z.number().optional() }).strict(),
  z.object({ type: z.literal("price"), ...base }).strict(),
  z.object({ type: z.literal("date"), ...base }).strict(),
  z.object({ type: z.literal("time"), ...base }).strict(),
  z.object({ type: z.literal("hours"), ...base }).strict(),
  z.object({ type: z.literal("boolean"), ...base, default: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("select"), ...base, options: z.array(z.string().trim().min(1).max(60).regex(/^[^<>]*$/)).min(1).max(40) }).strict(),
  z.object({ type: z.literal("url"), ...base }).strict(),
  z.object({ type: z.literal("email"), ...base }).strict(),
  z.object({ type: z.literal("phone"), ...base }).strict(),
  z.object({ type: z.literal("image"), ...base, aspect: z.string().regex(/^\d{1,2}:\d{1,2}$/).optional() }).strict(),
]);
export type Field = z.infer<typeof FieldSchema>;
export const FIELD_TYPES = ["text", "richtext", "number", "price", "date", "time", "hours", "boolean", "select", "url", "email", "phone", "image"] as const;

const fields = z.record(name(FIELD_NAME), FieldSchema).refine(value => Object.keys(value).length >= 1 && Object.keys(value).length <= CONTENT_LIMITS.fields, `Between 1 and ${CONTENT_LIMITS.fields} fields.`);
export const CollectionSchema = z.object({
  label, kind: z.enum(["list", "single"]), itemLabel: label.optional(), titleField: name(FIELD_NAME).optional(),
  maxItems: z.number().int().min(1).max(CONTENT_LIMITS.maxItems).optional(), sort: z.enum(["manual", "date-desc", "date-asc"]).optional(),
  help: z.string().max(200).regex(/^[^<>]*$/).optional(), fields,
}).strict().superRefine((value, context) => {
  if (value.titleField && !value.fields[value.titleField]) context.addIssue({ code: "custom", message: `titleField "${value.titleField}" is not a field.` });
  if (value.kind === "single" && (value.maxItems || value.sort || value.itemLabel)) context.addIssue({ code: "custom", message: "maxItems, sort and itemLabel apply to lists only." });
});
export type Collection = z.infer<typeof CollectionSchema>;
export const ManifestSchema = z.object({
  version: z.literal(1), locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  collections: z.record(name(COLLECTION_NAME), CollectionSchema).refine(value => Object.keys(value).length >= 1 && Object.keys(value).length <= CONTENT_LIMITS.collections, `Between 1 and ${CONTENT_LIMITS.collections} collections.`),
}).strict();
export type Manifest = z.infer<typeof ManifestSchema>;

export function parseManifest(text: string | undefined): { ok: true; manifest: Manifest } | { ok: false; error: string } {
  if (text === undefined) return { ok: false, error: "No content manifest." };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, error: `${MANIFEST_PATH} is not valid JSON.` }; }
  const parsed = ManifestSchema.safeParse(value);
  if (!parsed.success) { const issue = parsed.error.issues[0]; return { ok: false, error: `${MANIFEST_PATH}: ${issue.path.join(".") || "manifest"}: ${issue.message}` }; }
  return { ok: true, manifest: parsed.data };
}

// ---------------------------------------------------------------- text and links

/** NFC, without control characters, bidi overrides or angle brackets' dangerous cousins (React escapes the rest). */
export function cleanText(value: string, multiline = false) {
  const normal = value.normalize("NFC").replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g, "");
  const stripped = multiline ? normal.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n?/g, "\n") : normal.replace(/[\u0000-\u001F\u007F]/g, " ");
  return multiline ? stripped.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() : stripped.replace(/\s+/g, " ").trim();
}

/** https web addresses (no credentials), mailto:, tel:, a site route ("/menu") or an anchor ("#visit"). */
export function safeLink(value: string, routes: readonly string[] = []) {
  const link = value.trim();
  // Phone links may contain single spaces ("tel:+44 117 496 0000"); nothing else may contain whitespace.
  if (/^tel:\+?[0-9() .-]{5,30}$/i.test(link)) return true;
  if (!link || /[\s\\]/.test(link) || link.length > 500) return false;
  if (/^#[A-Za-z][\w-]{0,60}$/.test(link)) return true;
  if (/^\/(?!\/)[A-Za-z0-9/_-]*(?:#[A-Za-z][\w-]{0,60})?$/.test(link)) return link.split("#")[0] === "/" || routes.length === 0 || routes.includes(link.split("#")[0]);
  if (/^mailto:[^@\s]{1,64}@[^@\s]{1,190}$/i.test(link)) return true;
  if (/^tel:\+?[0-9() .-]{5,30}$/i.test(link)) return true;
  try {
    const url = new URL(link);
    return url.protocol === "https:" && !url.username && !url.password && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname);
  } catch { return false; }
}

// ---------------------------------------------------------------- value validation

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const span = z.object({ open: z.string().regex(TIME, "Use a time like 09:00."), close: z.string().regex(TIME, "Use a time like 17:30.") }).strict();
export const HoursSchema = z.object({
  ...Object.fromEntries(DAYS.map(day => [day, z.array(span).max(3)])) as Record<(typeof DAYS)[number], z.ZodArray<typeof span>>,
  exceptions: z.array(z.object({ date: z.string().regex(DATE), closed: z.boolean(), label: z.string().max(80).regex(/^[^<>]*$/).optional(), spans: z.array(span).max(3).optional() }).strict()).max(40).optional(),
}).strict();
export type Hours = z.infer<typeof HoursSchema>;
export const RichTextSchema = z.array(z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string().max(4000) }).strict(),
  z.object({ type: z.literal("heading"), text: z.string().max(200) }).strict(),
  z.object({ type: z.literal("quote"), text: z.string().max(1000) }).strict(),
  z.object({ type: z.literal("list"), items: z.array(z.string().max(400)).max(50) }).strict(),
])).max(100);
export type RichText = z.infer<typeof RichTextSchema>;
export const emptyHours = (): Hours => ({ mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] });

type Context = { assets: ReadonlySet<string>; routes?: readonly string[] };
const ITEM_ID = /^[a-z0-9]{1,16}$/;

function fieldSchema(field: Field, context: Context): z.ZodType {
  const optional = (schema: z.ZodType) => field.required ? schema : schema.optional().nullable();
  switch (field.type) {
    case "text": return optional(z.string().transform(value => cleanText(value, field.multiline)).pipe(z.string().max(field.max ?? (field.multiline ? 2000 : 200), "Too long.").refine(value => !field.required || value.length > 0, "Required.")));
    case "richtext": return optional(RichTextSchema.transform(blocks => blocks.map(block => block.type === "list" ? { ...block, items: block.items.map(item => cleanText(item)) } : { ...block, text: cleanText(block.text, block.type === "paragraph") }))
      .refine(blocks => JSON.stringify(blocks).length <= (field.max ?? 8000) * 1.2, "Too long."));
    case "number": return optional(z.number().finite().refine(value => (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max), "Out of range."));
    case "price": return optional(z.string().trim().regex(/^\d{1,7}(\.\d{2})?$/, "Use a price like 12.50."));
    case "date": return optional(z.string().regex(DATE, "Use a date like 2026-10-15."));
    case "time": return optional(z.string().regex(TIME, "Use a time like 09:00."));
    case "hours": return optional(HoursSchema);
    case "boolean": return optional(z.boolean());
    case "select": return optional(z.enum(field.options as [string, ...string[]]));
    case "url": return optional(z.string().trim().refine(value => safeLink(value, context.routes), "Use a full https:// address, a page like /menu, mailto: or tel:."));
    case "email": return optional(z.string().trim().max(254).regex(/^[^@\s<>]{1,64}@[^@\s<>]{1,190}\.[a-z]{2,24}$/i, "Use an email address like hello@example.com."));
    case "phone": return optional(z.string().trim().regex(/^\+?[0-9() .-]{5,30}$/, "Use a phone number like +44 117 496 0000."));
    case "image": return optional(z.object({ src: z.string().refine(value => context.assets.has(value), "Choose one of the site's images."), alt: z.string().transform(value => cleanText(value)).pipe(z.string().max(300)) }).strict());
  }
}

/** Validator for one collection's data file. */
export function collectionSchema(collection: Collection, context: Context) {
  const item = z.object(Object.fromEntries(Object.entries(collection.fields).map(([key, field]) => [key, fieldSchema(field, context)]))).strict();
  if (collection.kind === "single") return item;
  return z.object({ items: z.array(item.extend({ id: z.string().regex(ITEM_ID, "Item ids are short lowercase letters and digits.") })).max(collection.maxItems ?? CONTENT_LIMITS.maxItems, `At most ${collection.maxItems ?? CONTENT_LIMITS.maxItems} items.`)
    .refine(items => new Set(items.map(entry => entry.id)).size === items.length, "Item ids must be unique.") }).strict();
}

/** Order-independent JSON for comparing values (object keys sorted; empty optional fields count as absent). */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== null && (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

/** Canonical file text: two-space JSON with a trailing newline, so version diffs stay readable. */
export const serialiseContent = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export type ContentCheck = { path: string; message: string };
/** Validates a collection file's JSON text; returns the normalised value or a plain-English problem. */
export function checkCollection(collection: Collection, text: string | undefined, context: Context): { ok: true; value: unknown; text: string } | { ok: false; message: string } {
  if (text === undefined) return { ok: false, message: "is missing." };
  if (text.length > CONTENT_LIMITS.fileBytes) return { ok: false, message: `is larger than ${CONTENT_LIMITS.fileBytes / 1000} KB.` };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, message: "is not valid JSON." }; }
  const parsed = collectionSchema(collection, context).safeParse(value);
  if (!parsed.success) { const issue = parsed.error.issues[0]; return { ok: false, message: `${issueLocation(collection, issue.path)}: ${issue.message}` }; }
  return { ok: true, value: parsed.data, text: serialiseContent(parsed.data) };
}

const words = (key: string) => key.replace(/_/g, " ").replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/^./, letter => letter.toUpperCase());
/** "Facebook" or "Service 4, Name" rather than internal keys. */
function issueLocation(collection: Collection, path: PropertyKey[]) {
  const field = (key: PropertyKey | undefined) => typeof key === "string" && collection.fields[key] ? collection.fields[key].label ?? words(key) : null;
  if (collection.kind === "list" && path[0] === "items") {
    if (typeof path[1] !== "number") return collection.label;
    return [`${collection.itemLabel ?? "Item"} ${path[1] + 1}`, field(path[2])].filter(Boolean).join(", ");
  }
  return field(path[0]) ?? collection.label;
}

/** Static checks for a project that declares content (the builder must fix these before finishing). */
export function contentProblems(files: ReadonlyMap<string, string>, assets: ReadonlySet<string>, routes: readonly string[] = []): ContentCheck[] {
  const manifestText = files.get(MANIFEST_PATH);
  const dataFiles = [...files.keys()].filter(path => path.startsWith(CONTENT_DIR) && path.endsWith(".json") && path !== MANIFEST_PATH);
  if (manifestText === undefined) return dataFiles.map(path => ({ path, message: `${path} has no declaration in ${MANIFEST_PATH}.` }));
  const parsed = parseManifest(manifestText);
  if (!parsed.ok) return [{ path: MANIFEST_PATH, message: parsed.error }];
  const problems: ContentCheck[] = [];
  const code = [...files.entries()].filter(([path]) => /\.(tsx?|jsx?)$/.test(path) && !path.startsWith(CONTENT_DIR)).map(([, text]) => text).join("\n");
  let total = 0;
  for (const [key, collection] of Object.entries(parsed.manifest.collections)) {
    const path = collectionPath(key), result = checkCollection(collection, files.get(path), { assets, routes });
    total += files.get(path)?.length ?? 0;
    if (!result.ok) problems.push({ path, message: `${path} ${result.message}` });
    if (!new RegExp(`content/${key}\\.json["']`).test(code)) problems.push({ path, message: `${path} is declared but no component imports it.` });
  }
  for (const path of dataFiles) if (!parsed.manifest.collections[path.slice(CONTENT_DIR.length, -5)]) problems.push({ path, message: `${path} has no declaration in ${MANIFEST_PATH}.` });
  if (total > CONTENT_LIMITS.totalBytes) problems.push({ path: MANIFEST_PATH, message: `Content files exceed ${CONTENT_LIMITS.totalBytes / 1000} KB in total.` });
  return problems;
}

/** The project's editable collections (manifest valid), with their current values. */
export function readCollections(files: ReadonlyMap<string, string>, assets: ReadonlySet<string>) {
  const parsed = parseManifest(files.get(MANIFEST_PATH));
  if (!parsed.ok) return null;
  return { manifest: parsed.manifest, collections: Object.entries(parsed.manifest.collections).map(([key, collection]) => {
    const result = checkCollection(collection, files.get(collectionPath(key)), { assets });
    return { key, collection, path: collectionPath(key), value: result.ok ? result.value : null, problem: result.ok ? null : result.message };
  }) };
}

/** Plain-English summary of what changed between two versions of a collection ("Menu: 2 changed, 1 added"). */
export function describeChange(collection: Collection, before: unknown, after: unknown) {
  if (collection.kind === "single") return canonical(before) === canonical(after) ? null : `${collection.label}: updated`;
  const items = (value: unknown) => new Map(((value as { items?: { id: string }[] } | null)?.items ?? []).map(item => [item.id, canonical(item)]));
  const a = items(before), b = items(after);
  const added = [...b.keys()].filter(id => !a.has(id)).length, removed = [...a.keys()].filter(id => !b.has(id)).length;
  const changed = [...b.keys()].filter(id => a.has(id) && a.get(id) !== b.get(id)).length;
  const reordered = !added && !removed && !changed && [...a.keys()].join() !== [...b.keys()].join();
  const parts = [changed && `${changed} changed`, added && `${added} added`, removed && `${removed} removed`, reordered && "reordered"].filter(Boolean);
  return parts.length ? `${collection.label}: ${parts.join(", ")}` : null;
}

/** A short random item id for new list entries. */
export const newItemId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => "abcdefghijklmnopqrstuvwxyz0123456789"[byte % 36]).join("");
