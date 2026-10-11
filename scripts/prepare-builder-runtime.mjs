// Prepares the self-hosted in-browser preview runtime under public/builder-runtime:
// the esbuild WebAssembly bundler, one shared ESM build of React, per-icon
// Lucide modules and the curated woff2 font library. Runs before `next dev`
// and `next build`; output is generated, not committed.
// `--icons-manifest` regenerates src/lib/builder/lucide-icons.json (committed)
// after a lucide-react upgrade.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as esbuild from "esbuild-wasm";

const require = createRequire(import.meta.url);
const root = process.cwd();
const out = join(root, "public", "builder-runtime");
const modules = join(root, "node_modules");
const wasmDir = join(modules, "esbuild-wasm");
const lucideDir = join(modules, "lucide-react", "dist", "esm");
const catalogPath = join(root, "src", "lib", "builder", "font-catalog.json");
const iconManifestPath = join(root, "src", "lib", "builder", "lucide-icons.json");
const { version: esbuildVersion } = JSON.parse(await readFile(join(wasmDir, "package.json"), "utf8"));
const { version: reactVersion } = require("react/package.json");
const { version: lucideVersion } = require("lucide-react/package.json");
const catalogText = await readFile(catalogPath, "utf8");
const catalog = JSON.parse(catalogText);

/** Lucide's own export list: canonical icon file -> every exported name. */
async function lucideExports() {
  const index = await readFile(join(lucideDir, "lucide-react.mjs"), "utf8");
  const icons = {};
  for (const match of index.matchAll(/export \{([^}]*)\} from '\.\/icons\/([a-z0-9-]+)\.mjs';/g)) {
    icons[match[2]] = match[1].split(",").map(name => name.trim().replace(/^default as /, ""));
  }
  if (Object.keys(icons).length < 1000) throw new Error("Unexpected lucide-react layout: icon exports not found.");
  return icons;
}
const pascal = file => file.split("-").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join("");

if (process.argv.includes("--icons-manifest")) {
  const icons = {};
  for (const [file, names] of Object.entries(await lucideExports())) {
    const set = new Set(names);
    // `XIcon` and `LucideX` spellings are derived at lookup time.
    icons[file] = names.filter(name => name !== pascal(file) && !(name.endsWith("Icon") && set.has(name.slice(0, -4))) && !(name.startsWith("Lucide") && set.has(name.slice(6)))).join(",");
  }
  await writeFile(iconManifestPath, `${JSON.stringify({ version: lucideVersion, icons })}\n`);
  console.log(`wrote ${Object.keys(icons).length} Lucide icons to src/lib/builder/lucide-icons.json`);
  process.exit(0);
}

const iconManifest = JSON.parse(await readFile(iconManifestPath, "utf8"));
if (iconManifest.version !== lucideVersion) {
  throw new Error(`src/lib/builder/lucide-icons.json is for lucide-react ${iconManifest.version}, installed ${lucideVersion}. Run: node scripts/prepare-builder-runtime.mjs --icons-manifest`);
}
const stamp = `${esbuildVersion}-${reactVersion}-${lucideVersion}-${createHash("sha256").update(catalogText).digest("hex").slice(0, 12)}`;

try {
  if ((await readFile(join(out, "VERSION"), "utf8")).trim() === stamp) process.exit(0);
} catch { /* first run */ }

await rm(out, { recursive: true, force: true });
await mkdir(join(out, "vendor", "lucide", "icons"), { recursive: true });
await mkdir(join(out, "fonts", "licenses"), { recursive: true });
await copyFile(join(wasmDir, "esbuild.wasm"), join(out, "esbuild.wasm"));
await copyFile(join(wasmDir, "esm", "browser.min.js"), join(out, "esbuild.js"));

// React ships CommonJS, so `export *` would drop named exports. Re-export each
// key explicitly. Splitting keeps a single shared React instance across entries.
const reexport = specifier => {
  const keys = Object.keys(require(specifier)).filter(key => /^[A-Za-z_$][\w$]*$/.test(key) && key !== "default");
  return `import M from '${specifier}'; export default M; export const { ${keys.join(", ")} } = M;`;
};
const entries = {
  react: reexport("react"),
  "react-dom": reexport("react-dom"),
  "react-dom-client": reexport("react-dom/client"),
  "jsx-runtime": reexport("react/jsx-runtime"),
  // Lucide's shared runtime. Its `react` import stays bare; the preview
  // bundler maps it to the vendored React above (one React instance).
  "lucide/core": `export { default as createLucideIcon } from 'lucide-react/dist/esm/createLucideIcon.mjs';
export { default as Icon } from 'lucide-react/dist/esm/Icon.mjs';
export { LucideProvider, useLucideContext } from 'lucide-react/dist/esm/context.mjs';`,
};
const virtual = "makeborne-vendor:";
await esbuild.build({
  entryPoints: Object.keys(entries).map(name => ({ in: `${virtual}${name}`, out: name })),
  bundle: true, splitting: true, format: "esm", minify: true, target: "es2022",
  outdir: join(out, "vendor"), absWorkingDir: root, logLevel: "error",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "vendor-entries",
    setup(build) {
      build.onResolve({ filter: /^makeborne-vendor:/ }, args => ({ path: args.path.slice(virtual.length), namespace: "vendor" }));
      build.onResolve({ filter: /^react$/ }, args => args.importer.includes("lucide-react") ? { path: "react", external: true } : undefined);
      build.onLoad({ filter: /.*/, namespace: "vendor" }, args => ({ contents: entries[args.path], resolveDir: root, loader: "js" }));
    },
  }],
});

// One tiny module per icon so a site bundles only the icons it imports.
const license = `/** lucide-react v${lucideVersion} | ISC License | Copyright (c) Lucide Icons and Contributors | see ../LICENSE */\n`;
for (const file of Object.keys(iconManifest.icons)) {
  const source = await readFile(join(lucideDir, "icons", `${file}.mjs`), "utf8");
  const original = "import createLucideIcon from '../createLucideIcon.mjs';";
  if (!source.includes(original)) throw new Error(`Unexpected Lucide icon module: ${file}`);
  const body = source.replace(/^\/\*\*[\s\S]*?\*\/\s*/, "").replace(/\/\/# sourceMappingURL=.*$/m, "")
    .replace(original, "import { createLucideIcon } from '../core.js';");
  await writeFile(join(out, "vendor", "lucide", "icons", `${file}.js`), license + body.trim() + "\n");
}
await copyFile(join(modules, "lucide-react", "LICENSE"), join(out, "vendor", "lucide", "LICENSE"));

// Fonts: latin subset only, one woff2 per family and style (OFL-1.1).
for (const font of catalog) {
  const variable = !/^\d+$/.test(font.axis);
  const dir = join(modules, variable ? "@fontsource-variable" : "@fontsource", font.id);
  const metadata = JSON.parse(await readFile(join(dir, "metadata.json"), "utf8"));
  const weight = variable ? `${metadata.variable.wght.min} ${metadata.variable.wght.max}` : font.axis;
  if (metadata.family !== font.family || weight !== font.weight || metadata.license?.type !== "OFL-1.1") throw new Error(`Font catalogue entry ${font.id} does not match its package metadata.`);
  for (const style of font.italic ? ["normal", "italic"] : ["normal"]) {
    await copyFile(join(dir, "files", `${font.id}-latin-${font.axis}-${style}.woff2`), join(out, "fonts", `${font.id}-${style}.woff2`));
  }
  const licenseFile = (await readdir(dir)).find(name => /^LICENSE/i.test(name));
  if (licenseFile) await copyFile(join(dir, licenseFile), join(out, "fonts", "licenses", `${font.id}.txt`));
}

await writeFile(join(out, "VERSION"), stamp);
console.log(`builder runtime ready (esbuild ${esbuildVersion}, react ${reactVersion}, lucide ${lucideVersion}, ${catalog.length} fonts)`);
