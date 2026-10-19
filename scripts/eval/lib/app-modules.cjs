/* eslint-disable @typescript-eslint/no-require-imports -- Loads the app's own TypeScript modules so the eval measures the real code paths. */
// Runs selected src/ modules under plain Node, the same way the existing
// qualification scripts do (scripts/render-quality-websites.cjs):
// - `server-only` is stubbed (these modules never run in a browser here);
// - esbuild-wasm initialises itself in Node, so its initialize() is a no-op;
// - TypeScript is transpiled per file with the repo's own `typescript`;
// - the builder runtime (/builder-runtime/*) is read from public/ on disk with
//   a fixed fake origin, so bundling never touches the network.
// Nothing here calls a provider or a database.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const assert = require("node:assert/strict");

const REPO = path.resolve(__dirname, "..", "..", "..");
const RUNTIME = path.join(REPO, "public", "builder-runtime");
const ORIGIN = "http://runtime.test";
const ts = require(path.join(REPO, "node_modules", "typescript"));

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  const load = Module._load;
  Module._load = function patched(name, parent, isMain) {
    if (name === "server-only") return {};
    if (name === "esbuild-wasm" && parent?.filename?.endsWith("browser-bundler.ts")) return { ...load.call(this, name, parent, isMain), initialize: async () => {} };
    return load.call(this, name, parent, isMain);
  };
  // "@/x" imports resolve to src/x like the app's tsconfig paths.
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function patchedResolve(request, parent, ...rest) {
    if (typeof request === "string" && request.startsWith("@/")) request = path.join(REPO, "src", request.slice(2));
    return resolve.call(this, request, parent, ...rest);
  };
  const compile = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
  require.extensions[".ts"] = compile;
  require.extensions[".tsx"] = compile;
  if (!fs.existsSync(path.join(RUNTIME, "esbuild.wasm"))) throw new Error("public/builder-runtime is missing: run `npm run prepare-runtime` first");
  if (typeof globalThis.location === "undefined") globalThis.location = { origin: ORIGIN };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const value = String(url);
    if (value.startsWith(`${ORIGIN}/builder-runtime/`)) {
      const file = path.resolve(RUNTIME, value.slice(`${ORIGIN}/builder-runtime/`.length));
      assert(file.startsWith(RUNTIME + path.sep), "builder runtime path escaped its folder");
      return new Response(fs.readFileSync(file));
    }
    if (!realFetch) throw new Error(`fetch unavailable for ${value}`);
    return realFetch(url, init);
  };
}

/** Load a module from src/ by repo-relative path, e.g. "src/lib/builder/browser-bundler.ts". */
function loadApp(relative) {
  install();
  return require(path.join(REPO, relative));
}

module.exports = { loadApp, REPO, RUNTIME, RUNTIME_ORIGIN: ORIGIN };
