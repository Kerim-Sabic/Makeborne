/** Trusted image entrypoint. No generated config, plugins or install scripts. */
import {readFile, writeFile, mkdir, symlink, readdir, lstat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {build} from "vite";
import ts from "typescript";
import {canonicalRuntimeJson as canonical} from "./identity.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
const root = "/tmp/project", output = "/tmp/result";
try {
  const raw = await readFile("/input/request.json");
  if (raw.length > 65_000_000) throw new Error("INPUT_LIMIT");
  const request = JSON.parse(raw);
  const runtimeImageId = process.env.MAKEBORNE_RUNTIME_IMAGE;
  if (request.schemaVersion !== 1 || request.toolchainId !== "react-vite-v1"
    || !/^sha256:[a-f0-9]{64}$/.test(runtimeImageId ?? "")
    || !/^[a-f0-9]{64}$/.test(request.sourceHash) || !/^[a-f0-9]{64}$/.test(request.toolchainHash)
    || !Array.isArray(request.files) || request.files.length > 300) throw new Error("INPUT_INVALID");
  const sourceManifest = request.sourceManifest;
  if (!sourceManifest || sourceManifest.schemaVersion !== 1 || sourceManifest.toolchainId !== request.toolchainId
    || !Array.isArray(sourceManifest.files) || !Array.isArray(sourceManifest.assets)
    || digest(`${canonical(sourceManifest)}\n`) !== request.sourceHash
    || canonical(sourceManifest.routes) !== canonical(request.routes)) throw new Error("SOURCE_IDENTITY_MISMATCH");
  const expectedFiles = new Map([...sourceManifest.files, ...sourceManifest.assets].map(file => [file.path, file]));
  if (expectedFiles.size !== request.files.length || sourceManifest.files.length + sourceManifest.assets.length !== expectedFiles.size) throw new Error("SOURCE_FILES_MISMATCH");
  const pinnedPackage = JSON.parse(await readFile("/opt/makeborne/package.json", "utf8"));
  const pinnedLock = JSON.parse(await readFile("/opt/makeborne/package-lock.json", "utf8"));
  if (request.toolchainHash !== digest(canonical({id: "react-vite-v1", package: pinnedPackage, lock: pinnedLock}))) throw new Error("TOOLCHAIN_MISMATCH");
  await mkdir(root, {recursive: true});
  const paths = new Set(); let total = 0;
  for (const file of request.files) {
    if (typeof file.path !== "string" || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(file.path)
      || file.path.split("/").some(part => part === "." || part === ".." || ["node_modules", ".git", ".env", "dist"].includes(part.toLowerCase()))
      || paths.has(file.path.toLowerCase())) throw new Error("PATH_INVALID");
    paths.add(file.path.toLowerCase());
    const bytes = Buffer.from(file.base64, "base64"); total += bytes.length;
    const expected = expectedFiles.get(file.path);
    if (!expected || expected.bytes !== file.bytes || expected.sha256 !== file.sha256
      || bytes.length !== file.bytes || digest(bytes) !== file.sha256 || total > 42_000_000) throw new Error("FILE_CHANGED");
    if (["package.json", "package-lock.json"].includes(file.path)) {
      if (canonical(JSON.parse(bytes)) !== canonical(file.path === "package.json" ? pinnedPackage : pinnedLock)) throw new Error("PACKAGE_REJECTED");
    }
    const destination = `${root}/${file.path}`;
    await mkdir(destination.slice(0, destination.lastIndexOf("/")), {recursive: true});
    await writeFile(destination, bytes, {flag: "wx", mode: 0o600});
  }
  for (const required of ["package.json", "package-lock.json", "index.html", "src/main.tsx"]) if (!paths.has(required)) throw new Error("SOURCE_MISSING");
  await symlink("/opt/makeborne/node_modules", `${root}/node_modules`, "dir");
  const started = Date.now();
  const program = ts.createProgram(request.files.filter(file => /\.[cm]?tsx?$/.test(file.path)).map(file => `${root}/${file.path}`), {
    strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"], types: ["react", "react-dom"],
    typeRoots: ["/opt/makeborne/node_modules/@types"], allowImportingTsExtensions: true, resolveJsonModule: true,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw new Error(ts.formatDiagnostics(diagnostics.slice(0, 15), {
    getCanonicalFileName: file => file.replace(`${root}/`, ""), getCurrentDirectory: () => root, getNewLine: () => "\n",
  }));
  await build({root, configFile: false, envDir: false, mode: "production", logLevel: "warn",
    oxc: {jsx: {runtime: "automatic"}}, css: {postcss: {plugins: []}},
    build: {outDir: output, emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0, target: "es2022"}});
  const files = []; let outputBytes = 0;
  async function inspect(directory, prefix = "") {
    for (const name of (await readdir(directory)).sort()) {
      const path = `${directory}/${name}`, relative = `${prefix}${name}`, stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error("OUTPUT_LINK_REJECTED");
      if (stat.isDirectory()) await inspect(path, `${relative}/`);
      else if (stat.isFile()) {
        outputBytes += stat.size;
        if (outputBytes > 50_000_000 || files.length >= 1000) throw new Error("OUTPUT_LIMIT");
        files.push({path: relative, bytes: stat.size, sha256: digest(await readFile(path))});
      } else throw new Error("OUTPUT_TYPE_REJECTED");
    }
  }
  await inspect(output);
  if (!files.some(file => file.path === "index.html")) throw new Error("OUTPUT_MISSING");
  const identity = {schemaVersion: 1, artifactId: request.artifactId, revisionId: request.revisionId, version: request.version,
    sourceHash: request.sourceHash, toolchainId: request.toolchainId, toolchainHash: request.toolchainHash, runtimeImageId, routes: request.routes, files};
  await writeFile(`${output}/makeborne-build.json`, JSON.stringify({...identity, buildHash: digest(canonical(identity))}));
  console.log(JSON.stringify({status: "built", sourceHash: request.sourceHash, fileCount: files.length, outputBytes, buildMs: Date.now() - started}));
  await writeFile("/tmp/build-complete", "ready");
  // tmpfs exists only while the container is alive. The controller copies the
  // verified output, then disposes us; this independent lease prevents leaks.
  setTimeout(() => process.exit(0), 65000);
} catch (error) {
  // Compiler diagnostics stay inside operator logs; no credentials are injected.
  console.error("BUILD_FAILED", String(error?.message ?? "Unknown build error").slice(0, 4000));
  process.exitCode = 1;
}
