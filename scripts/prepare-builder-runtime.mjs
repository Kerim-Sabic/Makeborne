// Prepares the self-hosted in-browser preview runtime under public/builder-runtime:
// the esbuild WebAssembly bundler plus one shared ESM build of React for previews.
// Runs before `next dev` and `next build`; output is generated, not committed.
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as esbuild from "esbuild-wasm";

const require = createRequire(import.meta.url);
const root = process.cwd();
const out = join(root, "public", "builder-runtime");
const wasmDir = join(root, "node_modules", "esbuild-wasm");
const { version: esbuildVersion } = JSON.parse(await readFile(join(wasmDir, "package.json"), "utf8"));
const { version: reactVersion } = require("react/package.json");
const stamp = `${esbuildVersion}-${reactVersion}`;

try {
  if ((await readFile(join(out, "VERSION"), "utf8")).trim() === stamp) process.exit(0);
} catch { /* first run */ }

await rm(out, { recursive: true, force: true });
await mkdir(join(out, "vendor"), { recursive: true });
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
};
const virtual = "makeborne-vendor:";
await esbuild.build({
  entryPoints: Object.keys(entries).map(name => ({ in: `${virtual}${name}`, out: name })),
  bundle: true, splitting: true, format: "esm", minify: true, target: "es2022",
  outdir: join(out, "vendor"), absWorkingDir: root, logLevel: "warning",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "vendor-entries",
    setup(build) {
      build.onResolve({ filter: /^makeborne-vendor:/ }, args => ({ path: args.path.slice(virtual.length), namespace: "vendor" }));
      build.onLoad({ filter: /.*/, namespace: "vendor" }, args => ({ contents: entries[args.path], resolveDir: root, loader: "js" }));
    },
  }],
});
await writeFile(join(out, "VERSION"), stamp);
console.log(`builder runtime ready (esbuild ${esbuildVersion}, react ${reactVersion})`);
