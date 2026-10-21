// Prepares the self-hosted in-browser preview runtime under public/builder-runtime:
// the esbuild WebAssembly bundler, one shared ESM build of React, per-icon
// Lucide modules, the curated woff2 font library and the DOM rasteriser
// (modern-screenshot) inlined into design-review captures. Runs before
// `next dev` and `next build`; output is generated, not committed.
// `--icons-manifest` regenerates src/lib/builder/lucide-icons.json (committed)
// after a lucide-react upgrade.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as esbuild from "esbuild-wasm";
import {prepareFontLicenses} from "./prepare-font-licenses.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const out = join(root, "public", "builder-runtime");
const modules = join(root, "node_modules");
const wasmDir = join(modules, "esbuild-wasm");
const lucideDir = join(modules, "lucide-react", "dist", "esm");
const catalogPath = join(root, "infra", "project-runtime", "font-catalog.json");
const iconManifestPath = join(root, "src", "lib", "builder", "lucide-icons.json");
const { version: esbuildVersion } = JSON.parse(await readFile(join(wasmDir, "package.json"), "utf8"));
const { version: reactVersion } = require("react/package.json");
const { version: lucideVersion } = require("lucide-react/package.json");
const catalogText = await readFile(catalogPath, "utf8");
const catalog = JSON.parse(catalogText);
const portabilityPath = join(root, "infra", "project-runtime", "font-portability.cjs");
const {FONT_SUBSETS, UNICODE_RANGES, packageFontFile, runtimeFontFile} = require(portabilityPath);
// The subset file layout and its unicode-ranges are part of the runtime identity.
const portabilityText = (await readFile(portabilityPath, "utf8")).replace(/\r\n/g, "\n");
// Verify even when the browser runtime cache is current.
await prepareFontLicenses();

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
const screenshotDir = join(modules, "modern-screenshot");
const { version: screenshotVersion } = JSON.parse(await readFile(join(screenshotDir, "package.json"), "utf8"));
const stamp = `${esbuildVersion}-${reactVersion}-${screenshotVersion}-${lucideVersion}-${createHash("sha256").update(catalogText).update(portabilityText).digest("hex").slice(0, 12)}`;

/** The rendered-contrast finish gate's in-browser probe (src/lib/builder/contrast-probe.ts), rebuilt on every run
 * because it is app code, not a vendored package: the server loads it from /builder-runtime/contrast-probe.js. */
async function buildContrastProbe() {
  await mkdir(out, { recursive: true });
  await esbuild.build({ entryPoints: [join(root, "src", "lib", "builder", "contrast-probe.ts")], bundle: true, outfile: join(out, "contrast-probe.js"),
    platform: "browser", format: "iife", target: "es2022", absWorkingDir: root, logLevel: "error", legalComments: "none", minify: true,
    define: { "process.env.NODE_ENV": '"production"' } });
}

try {
  if ((await readFile(join(out, "VERSION"), "utf8")).trim() === stamp) { await buildContrastProbe(); process.exit(0); }
} catch { /* first run */ }

await rm(out, { recursive: true, force: true });
await mkdir(join(out, "vendor", "lucide", "icons"), { recursive: true });
await mkdir(join(out, "fonts", "licenses"), { recursive: true });
await copyFile(join(wasmDir, "esbuild.wasm"), join(out, "esbuild.wasm"));
await copyFile(join(wasmDir, "esm", "browser.min.js"), join(out, "esbuild.js"));
// UMD build: defines globalThis.modernScreenshot when inlined as a classic script.
await copyFile(join(screenshotDir, "dist", "index.js"), join(out, "vendor", "modern-screenshot.js"));

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

// Fonts (OFL-1.1): per family and style, the latin file under its original name
// plus the complementary latin-ext file, whose unicode-ranges must match the package.
for (const font of catalog) {
  const variable = !/^\d+$/.test(font.axis);
  const dir = join(modules, variable ? "@fontsource-variable" : "@fontsource", font.id);
  const metadata = JSON.parse(await readFile(join(dir, "metadata.json"), "utf8"));
  const weight = variable ? `${metadata.variable.wght.min} ${metadata.variable.wght.max}` : font.axis;
  if (metadata.family !== font.family || weight !== font.weight || metadata.license?.type !== "OFL-1.1") throw new Error(`Font catalogue entry ${font.id} does not match its package metadata.`);
  const ranges = JSON.parse(await readFile(join(dir, "unicode.json"), "utf8"));
  for (const subset of FONT_SUBSETS) if (ranges[subset] !== UNICODE_RANGES[subset]) throw new Error(`Font ${font.id} ${subset} unicode-range differs from infra/project-runtime/font-portability.cjs.`);
  for (const style of font.italic ? ["normal", "italic"] : ["normal"]) for (const subset of FONT_SUBSETS) {
    await copyFile(join(dir, "files", packageFontFile(font, style, subset)), join(out, "fonts", runtimeFontFile(font, style, subset)));
  }
  const licenseFile = (await readdir(dir)).find(name => /^LICENSE/i.test(name));
  if (licenseFile) await copyFile(join(dir, licenseFile), join(out, "fonts", "licenses", `${font.id}.txt`));
}

await buildContrastProbe();
await writeFile(join(out, "VERSION"), stamp);
console.log(`builder runtime ready (esbuild ${esbuildVersion}, react ${reactVersion}, modern-screenshot ${screenshotVersion}, lucide ${lucideVersion}, ${catalog.length} fonts)`);
