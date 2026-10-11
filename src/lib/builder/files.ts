import projectPackage from "../../../infra/project-runtime/toolchain/package.json";
import projectLock from "../../../infra/project-runtime/toolchain/package-lock.json";
import {
  SourcePathSchema, WebsiteProjectSourceSchema, WEBSITE_SOURCE_LIMITS,
  type WebsiteProjectSource,
} from "../projects/website-source";

export type SourceAsset = WebsiteProjectSource["assets"][number];
export type DesignDirection = NonNullable<WebsiteProjectSource["designDirection"]>;
export type Route = WebsiteProjectSource["routes"][number];

/** Files the server owns. The model may read the dependency list but never edit these. */
const PROTECTED = /^(?:package\.json|package-lock\.json)$|(?:^|\/)(?:vite|postcss|tailwind|tsconfig)[^/]*\.(?:js|cjs|mjs|ts|json)$/i;
const EDITABLE_EXTENSION = /\.(?:tsx?|jsx?|css|html|json|md|svg|txt)$/i;
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

export class FileToolError extends Error {}

/** Mutable working copy of one website project used during a builder run. */
export class ProjectFiles {
  readonly files = new Map<string, string>();
  readonly assets = new Map<string, SourceAsset>();
  routes: Route[] = [];
  design: DesignDirection | undefined;
  readonly changed = new Set<string>();

  constructor(source?: WebsiteProjectSource | null) {
    if (!source) return;
    for (const file of source.files) if (!PROTECTED.test(file.path)) this.files.set(file.path, file.content);
    for (const asset of source.assets) this.assets.set(asset.path, asset);
    this.routes = [...source.routes];
    this.design = source.designDirection;
  }

  static checkPath(path: string) {
    const parsed = SourcePathSchema.safeParse(path);
    if (!parsed.success) throw new FileToolError(`Invalid path "${path}". Use a relative project path like src/components/Hero.tsx.`);
    if (PROTECTED.test(path)) throw new FileToolError(`${path} is managed by Makeborne and cannot be edited. Only react and react-dom are available; do not add dependencies or build configuration.`);
    if (path.startsWith("public/")) throw new FileToolError("Files under public/ are reserved for generated images. Use generate_image for artwork and plain CSS/SVG for decoration.");
    if (!EDITABLE_EXTENSION.test(path)) throw new FileToolError(`Unsupported file type for ${path}. Use .tsx, .ts, .css, .html, .json, .svg or .md.`);
    return parsed.data;
  }

  write(path: string, content: string) {
    ProjectFiles.checkPath(path);
    if (content.includes("\0") || !content.isWellFormed()) throw new FileToolError("File content must be valid text.");
    if (bytes(content) > WEBSITE_SOURCE_LIMITS.fileBytes) throw new FileToolError(`${path} is too large. Split it into smaller components (max ${WEBSITE_SOURCE_LIMITS.fileBytes / 1000} KB per file).`);
    for (const existing of this.files.keys()) {
      if (existing !== path && existing.toLowerCase() === path.toLowerCase()) throw new FileToolError(`${existing} already exists with different letter case.`);
      if (existing.startsWith(`${path}/`) || path.startsWith(`${existing}/`)) throw new FileToolError(`${path} conflicts with ${existing} (a file cannot also be a folder).`);
    }
    if (!this.files.has(path) && this.files.size >= WEBSITE_SOURCE_LIMITS.files - 2) throw new FileToolError("The project has reached its file limit. Combine smaller files.");
    this.files.set(path, content);
    this.changed.add(path);
    if (this.totalBytes() > WEBSITE_SOURCE_LIMITS.totalBytes) {
      throw new FileToolError("The project exceeds its total size limit. Remove unused code.");
    }
  }

  edit(path: string, oldString: string, newString: string, replaceAll = false) {
    ProjectFiles.checkPath(path);
    const current = this.files.get(path);
    if (current === undefined) throw new FileToolError(`${path} does not exist. Use write_file to create it.`);
    if (!oldString) throw new FileToolError("old_string must not be empty.");
    const count = current.split(oldString).length - 1;
    if (count === 0) throw new FileToolError(`old_string was not found in ${path}. Copy it exactly from the current file, including whitespace.`);
    if (count > 1 && !replaceAll) throw new FileToolError(`old_string appears ${count} times in ${path}. Include more surrounding context or set replace_all.`);
    this.write(path, replaceAll ? current.split(oldString).join(newString) : current.replace(oldString, () => newString));
  }

  remove(path: string) {
    ProjectFiles.checkPath(path);
    if (!this.files.delete(path)) throw new FileToolError(`${path} does not exist.`);
    this.changed.add(path);
  }

  addAsset(asset: SourceAsset) {
    this.assets.set(asset.path, asset);
  }

  totalBytes() {
    let total = 0;
    for (const content of this.files.values()) total += bytes(content);
    return total;
  }

  /** Model-facing snapshot: every editable file, byte for byte. */
  snapshot() {
    return [...this.files.entries()].sort(([a], [b]) => a < b ? -1 : 1)
      .map(([path, content]) => `<file path="${path}">\n${content}\n</file>`).join("\n\n");
  }

  /** Static checks the browser bundler would otherwise fail on: missing entry
   * files, unresolved relative imports and packages outside the toolchain. */
  problems(): string[] {
    const issues: string[] = [];
    for (const required of ["index.html", "src/main.tsx"]) if (!this.files.has(required)) issues.push(`Missing ${required}.`);
    const html = this.files.get("index.html");
    if (html && !/id=["']root["']/.test(html)) issues.push("index.html needs an element with id=\"root\".");
    const allowed = new Set(["react", "react-dom", "react-dom/client", "react/jsx-runtime"]);
    const assetPaths = new Set([...this.assets.keys()].map(path => `/${path.slice("public/".length)}`));
    for (const [path, content] of this.files) {
      if (!/\.(?:tsx?|jsx?|css)$/.test(path)) continue;
      const specifiers = path.endsWith(".css")
        ? [...content.matchAll(/@import\s+(?:url\()?["']([^"']+)["']/g)].map(match => match[1])
        : [...content.matchAll(/(?:^|[\s;])(?:import|export)\s[^"'`;]*?from\s*["']([^"']+)["']|(?:^|[\s;(])import\s*\(?\s*["']([^"']+)["']/gm)].map(match => match[1] ?? match[2]);
      for (const specifier of specifiers) {
        if (!specifier) continue;
        if (specifier.startsWith(".")) {
          if (!this.resolve(path, specifier)) issues.push(`${path} imports "${specifier}", which does not exist.`);
        } else if (specifier.startsWith("/")) {
          if (!assetPaths.has(specifier)) issues.push(`${path} references "${specifier}", which is not a generated image.`);
        } else if (!allowed.has(specifier)) {
          issues.push(`${path} imports "${specifier}". Only react and react-dom are installed; implement it with React and CSS instead.`);
        }
      }
    }
    return issues.slice(0, 20);
  }

  private resolve(from: string, specifier: string) {
    const base = from.split("/").slice(0, -1);
    for (const part of specifier.split("/")) {
      if (part === "..") base.pop(); else if (part !== ".") base.push(part);
    }
    const target = base.join("/");
    return ["", ".tsx", ".ts", ".jsx", ".js", ".css", "/index.tsx", "/index.ts"].some(suffix => this.files.has(target + suffix));
  }

  /** Canonical source for storage. Throws a readable error the agent can fix. */
  toSource(): WebsiteProjectSource {
    const routes = this.routes.length ? this.routes : [{ path: "/", title: "Home" }];
    const parsed = WebsiteProjectSourceSchema.safeParse({
      schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx",
      ...(this.design ? { designDirection: this.design } : {}),
      files: [...[...this.files.entries()].map(([path, content]) => ({ path, content })),
        { path: "package.json", content: JSON.stringify(projectPackage, null, 2) },
        { path: "package-lock.json", content: JSON.stringify(projectLock) }],
      assets: [...this.assets.values()],
      routes,
    });
    if (!parsed.success) throw new FileToolError(`The project is not valid yet: ${parsed.error.issues.slice(0, 3).map(issue => issue.message).join(" ")}`);
    return parsed.data;
  }
}

export const TOOLCHAIN_DEPENDENCIES = { ...projectPackage.dependencies };
