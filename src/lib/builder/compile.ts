import "server-only";
/** Server-side compile check for generated React/Vite websites. Bundles the
 * in-memory project with esbuild (the same engine and resolution rules as the
 * in-browser preview, src/lib/builder/browser-bundler.ts) without network,
 * npm or output files: React and lucide-react stay external, library fonts
 * resolve to empty stylesheets, and anything else outside the project fails
 * exactly as it would in the preview. Used at `finish` (errors go back to the
 * model) and before any save, so a stored version always builds. */
import type { Loader, Message, Plugin } from "esbuild-wasm";
import { FONT_IMPORT, FONTS_BY_ID } from "./fonts";
import { LUCIDE } from "./icons";

export type CompileOutcome =
  | { ok: true; ms: number; bytes: number }
  | { ok: false; ms: number; errors: string[] }
  /** The compiler itself could not run (not a project error). */
  | { ok: null; ms: number; reason: string };

const ENTRY = "src/main.tsx";

/** Admin self-test: compiles a two-file project so an operator can see the compiler runs in this deployment. Free, no model call. */
export function compilerSelfTest() {
  return compileWebsite(new Map([
    [ENTRY, `import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);\n`],
    ["src/App.tsx", "export default function App() { return <h1>Compiler self-test</h1>; }\n"],
  ]), { timeoutMs: 15_000 });
}
/** Packages the toolchain provides; the browser runtime supplies them. */
const EXTERNAL = new Set(["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", LUCIDE]);
const LOADERS: Record<string, Loader> = { tsx: "tsx", ts: "ts", jsx: "jsx", js: "js", mjs: "js", css: "css", json: "json", svg: "dataurl", txt: "text", md: "text" };
const MAX_ERRORS = 6;
const PLUGIN = "makeborne-compile";

function resolveRelative(files: ReadonlyMap<string, string>, importer: string, specifier: string) {
  const base = importer.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "..") base.pop(); else if (part !== ".") base.push(part);
  }
  const target = base.join("/");
  for (const suffix of ["", ".tsx", ".ts", ".jsx", ".js", ".css", "/index.tsx", "/index.ts", "/index.js"]) {
    if (files.has(target + suffix)) return target + suffix;
  }
  return null;
}

function projectPlugin(files: ReadonlyMap<string, string>): Plugin {
  return {
    name: PLUGIN,
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        const specifier = args.path;
        if (args.kind === "entry-point") return { path: specifier, namespace: "project" };
        if (EXTERNAL.has(specifier)) return { path: specifier, external: true };
        const font = FONT_IMPORT.exec(specifier);
        if (font) return FONTS_BY_ID.has(font[1]) ? { path: font[1], namespace: "font" } : { errors: [{ text: `"${specifier}" is not in the font library.` }] };
        if (specifier.startsWith("/") || /^(?:data|https?):/.test(specifier)) return { path: specifier, external: true };
        if (specifier.startsWith(".")) {
          const resolved = resolveRelative(files, args.importer, specifier);
          return resolved ? { path: resolved, namespace: "project" } : { errors: [{ text: `Cannot find "${specifier}" imported from ${args.importer}.` }] };
        }
        return { errors: [{ text: `"${specifier}" is not installed. Only react, react-dom and lucide-react are available.` }] };
      });
      build.onLoad({ filter: /.*/, namespace: "project" }, args => ({
        contents: files.get(args.path) ?? "", loader: LOADERS[args.path.slice(args.path.lastIndexOf(".") + 1).toLowerCase()] ?? "text",
      }));
      build.onLoad({ filter: /.*/, namespace: "font" }, () => ({ contents: "", loader: "css" }));
    },
  };
}

/** One readable line per error: "src/App.tsx:12:7: Expected ">" but found "}" (code)". */
function describe(message: Message) {
  const where = message.location;
  const text = message.text.replace(/\b(?:project|font):/g, "");
  if (!where) return text;
  const file = where.file.replace(/^(?:project|font):/, "");
  const line = where.lineText.trim().slice(0, 140);
  return `${file}:${where.line}:${where.column + 1}: ${text}${line ? ` (\`${line}\`)` : ""}`;
}

let engine: Promise<typeof import("esbuild-wasm")> | null = null;
const loadEngine = () => engine ??= import("esbuild-wasm").catch(error => { engine = null; throw error; });

/** Bundle the project in memory. Never touches the network or the disk. */
export async function compileWebsite(files: ReadonlyMap<string, string>, options: { timeoutMs?: number } = {}): Promise<CompileOutcome> {
  const started = Date.now();
  const ms = () => Date.now() - started;
  if (!files.has(ENTRY)) return { ok: false, ms: 0, errors: [`Missing ${ENTRY}.`] };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const esbuild = await loadEngine();
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("compile timed out")), options.timeoutMs ?? 20_000); });
    const result = await Promise.race([timeout, esbuild.build({
      entryPoints: [ENTRY], bundle: true, write: false, format: "esm", platform: "browser", outdir: "/makeborne-compile",
      target: "es2022", jsx: "automatic", minify: false, sourcemap: false, logLevel: "silent", legalComments: "none",
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env.MODE": '"production"', "import.meta.env.DEV": "false", "import.meta.env.PROD": "true" },
      plugins: [projectPlugin(files)],
    })]);
    const bytes = result.outputFiles.reduce((total, file) => total + file.contents.byteLength, 0);
    if (!result.outputFiles.some(file => file.path.endsWith(".js") && file.text.trim())) return { ok: false, ms: ms(), errors: ["The website build produced no script."] };
    return { ok: true, ms: ms(), bytes };
  } catch (error) {
    const messages = (error as { errors?: Message[] } | null)?.errors;
    // Project errors carry a source location or come from the resolver plugin;
    // anything else (engine missing, service stopped, timeout) is infrastructure.
    if (Array.isArray(messages) && messages.some(message => message.location || message.pluginName === PLUGIN)) {
      return { ok: false, ms: ms(), errors: messages.slice(0, MAX_ERRORS).map(describe) };
    }
    return { ok: null, ms: ms(), reason: error instanceof Error ? error.message.slice(0, 200) : "compiler unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

/** Model-facing problems for a project that does not compile ([] when it builds).
 * If the compiler itself cannot run, the static checks stand and this is logged. */
export async function compileProblems(files: ReadonlyMap<string, string>, compile: typeof compileWebsite = compileWebsite): Promise<string[]> {
  const outcome = await compile(files);
  if (outcome.ok === false) return [`The website does not compile. Fix these build errors:\n  ${outcome.errors.join("\n  ")}`];
  if (outcome.ok === null) console.error(JSON.stringify({ event: "builder_compile_unavailable", reason: outcome.reason, ms: outcome.ms }));
  return [];
}
