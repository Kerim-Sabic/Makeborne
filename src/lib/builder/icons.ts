/** Lucide icons (lucide-react, ISC) for generated websites. Projects import
 * named icons from "lucide-react"; the preview bundler resolves each icon to
 * its own vendored module, so only used icons reach the bundle. Icons render
 * to inline SVG, which survives the static publishing snapshot. */
import manifest from "./lucide-icons.json";

export const LUCIDE = "lucide-react";
/** Non-icon runtime exports provided by the vendored core module. */
export const LUCIDE_CORE = ["createLucideIcon", "Icon", "LucideProvider", "useLucideContext"] as const;
/** Type-only exports: erased by the compiler, never resolved to modules. */
const LUCIDE_TYPES = new Set(["LucideIcon", "LucideProps", "IconNode", "LucideIconData", "IconProps", "LucideIconNode", "SVGAttributes"]);

const pascal = (file: string) => file.split("-").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join("");
let index: Map<string, string> | null = null;
function icons() {
  if (index) return index;
  index = new Map();
  for (const [file, aliases] of Object.entries(manifest.icons as Record<string, string>)) {
    index.set(pascal(file), file);
    if (aliases) for (const alias of aliases.split(",")) index.set(alias, file);
  }
  return index;
}

/** Icon module file (kebab-case) for an exported name, accepting Lucide's
 * `XIcon` and `LucideX` spellings; null when no such icon exists. */
export function lucideIconFile(name: string): string | null {
  const map = icons();
  return map.get(name) ?? (name.endsWith("Icon") ? map.get(name.slice(0, -4)) : undefined) ?? (name.startsWith("Lucide") ? map.get(name.slice(6)) : undefined) ?? null;
}

const IMPORT = /\b(import|export)\s+(type\s+)?([\w$\s{},*]*?)\s*from\s*["']lucide-react(\/[^"']*)?["']/g;

/** Names a file imports from lucide-react, plus readable problems. */
export function lucideImports(content: string) {
  const names = new Set<string>();
  const problems: string[] = [];
  for (const match of content.matchAll(IMPORT)) {
    if (match[4]) { problems.push(`Import icons from "lucide-react" itself, not "lucide-react${match[4]}".`); continue; }
    if (match[2]) continue;
    const clause = match[3];
    if (/\*/.test(clause)) { problems.push('Import Lucide icons by name, e.g. import { ArrowRight } from "lucide-react" (namespace imports are not supported).'); continue; }
    const braces = /\{([^}]*)\}/.exec(clause);
    if (/^[\w$]+/.test(clause.trim()) && match[1] === "import") problems.push('lucide-react has no default export. Use named imports, e.g. import { ArrowRight } from "lucide-react".');
    for (const part of braces?.[1].split(",") ?? []) {
      const item = part.trim();
      if (!item || item.startsWith("type ")) continue;
      const name = item.split(/\s+as\s+/)[0].trim();
      if (!LUCIDE_TYPES.has(name)) names.add(name);
    }
  }
  return { names: [...names], problems };
}

/** Problems for icon names that do not exist in the vendored Lucide version. */
export function unknownLucideIcons(names: Iterable<string>) {
  const missing: string[] = [];
  for (const name of names) if (!(LUCIDE_CORE as readonly string[]).includes(name) && !lucideIconFile(name)) missing.push(name);
  return missing;
}

export const LUCIDE_VERSION = manifest.version;
