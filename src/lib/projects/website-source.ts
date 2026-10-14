import {z} from "zod";

export const WEBSITE_SOURCE_LIMITS = {files: 200, fileBytes: 256_000, totalBytes: 2_000_000, assets: 100, assetBytes: 20_000_000, totalAssetBytes: 40_000_000, routes: 100} as const;
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const reservedDirectories = new Set([".git", ".next", ".makeborne", "node_modules", "dist"]);
const windowsDevice = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/** Portable relative paths only. This does not make the file's executable content trusted. */
export const SourcePathSchema = z.string().min(1).max(240).refine(value => {
  const segments = value.split("/");
  return segments.every(segment => /^[A-Za-z0-9_.-]{1,100}$/.test(segment)
    && segment !== "." && segment !== ".." && !segment.endsWith(".")
    && !windowsDevice.test(segment) && !reservedDirectories.has(segment.toLowerCase())
    && !/^\.env(?:\.|$)/i.test(segment));
}, "Use a portable project path without traversal, build output, environment files or reserved files.");
const SourceFileSchema = z.object({path: SourcePathSchema, content: z.string().max(WEBSITE_SOURCE_LIMITS.fileBytes)
  .refine(value => value.isWellFormed() && !value.includes("\0") && bytes(value) <= WEBSITE_SOURCE_LIMITS.fileBytes,
    "Source text must be valid Unicode without null characters and within its byte limit.")}).strict();
export const SourceAssetSchema = z.object({id: z.string().uuid().transform(value => value.toLowerCase()), path: SourcePathSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(WEBSITE_SOURCE_LIMITS.assetBytes),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"])}).strict();
const routePath = z.string().max(240).regex(/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/);
const byPath = (a: {path: string}, b: {path: string}) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** Creative reference bound to the same immutable revision as its source. These
 * are descriptive decisions, never executable instructions or an approval. */
export const WebsiteDesignDirectionSchema = z.object({
  positioning: z.string().min(1).max(1000),
  composition: z.string().min(1).max(2000),
  typography: z.string().min(1).max(1000),
  palette: z.string().min(1).max(1000),
  imagery: z.string().min(1).max(1000),
  motion: z.string().min(1).max(1000),
}).strict();

/** Canonical source candidate, separate from runtime/build acceptance. Assets
 * must still be resolved against authorised immutable storage by the server. */
export const WebsiteProjectSourceSchema = z.object({
  schemaVersion: z.literal(1), toolchainId: z.literal("react-vite-v1"),
  entrypoint: z.literal("src/main.tsx"),
  designDirection: WebsiteDesignDirectionSchema.optional(),
  files: z.array(SourceFileSchema).min(1).max(WEBSITE_SOURCE_LIMITS.files),
  assets: z.array(SourceAssetSchema).max(WEBSITE_SOURCE_LIMITS.assets),
  routes: z.array(z.object({path: routePath, title: z.string().trim().min(1).max(200)}).strict()).min(1).max(WEBSITE_SOURCE_LIMITS.routes),
}).strict().superRefine((source, context) => {
  const paths = new Set<string>(), assetIds = new Set<string>();
  for (const [index, item] of [...source.files, ...source.assets].entries()) {
    const key = item.path.toLowerCase();
    if (paths.has(key)) context.addIssue({code: "custom", path: [index < source.files.length ? "files" : "assets", index < source.files.length ? index : index - source.files.length, "path"], message: "Project paths must be unique, including letter case."});
    paths.add(key);
  }
  for (const path of paths) {
    const segments = path.split("/");
    for (let length = 1; length < segments.length; length++) {
      if (paths.has(segments.slice(0, length).join("/"))) {
        context.addIssue({code: "custom", path: ["files"], message: "A project file cannot also be a parent directory."});
      }
    }
  }
  for (const [index, asset] of source.assets.entries()) {
    if (assetIds.has(asset.id)) context.addIssue({code: "custom", path: ["assets", index, "id"], message: "Asset identities must be unique."});
    assetIds.add(asset.id);
  }
  if (source.assets.reduce((total, asset) => total + asset.bytes, 0) > WEBSITE_SOURCE_LIMITS.totalAssetBytes) {
    context.addIssue({code: "custom", path: ["assets"], message: "Project artwork exceeds its total byte limit."});
  }
  const exactPaths = new Set(source.files.map(file => file.path));
  for (const required of ["package.json", "package-lock.json", "index.html", source.entrypoint]) {
    if (!exactPaths.has(required)) context.addIssue({code: "custom", path: ["files"], message: `Project source needs ${required}.`});
  }
  if (source.files.reduce((total, file) => total + bytes(file.content), 0) > WEBSITE_SOURCE_LIMITS.totalBytes) {
    context.addIssue({code: "custom", path: ["files"], message: "Project source exceeds its total byte limit."});
  }
  const routes = source.routes.map(route => route.path);
  if (!routes.includes("/") || new Set(routes).size !== routes.length) context.addIssue({code: "custom", path: ["routes"], message: "Routes need one home route and unique paths."});
  for (const filename of ["package.json", "package-lock.json"]) {
    const file = source.files.find(file => file.path === filename);
    if (!file) continue;
    try {
      const value: unknown = JSON.parse(file.content);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid package metadata");
    } catch {context.addIssue({code: "custom", path: ["files", source.files.indexOf(file), "content"], message: `${filename} must contain a JSON object.`});}
  }
}).transform(source => ({...source,
  files: [...source.files].sort(byPath),
  assets: [...source.assets].sort(byPath),
  routes: [...source.routes].sort(byPath),
}));
export type WebsiteProjectSource = z.infer<typeof WebsiteProjectSourceSchema>;
