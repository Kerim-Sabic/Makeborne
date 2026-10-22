// Operator tool: verify one saved website from the isolated local release-auth stack with the site verifier.
//   node scripts/verify-site.mjs --artifact <uuid> [--version <n>] [--out <dir>] [--viewports 390x844,1440x900]
//        [--only check,check] [--time-ms 300000] [--max-steps 4000] [--digest sha256:<hex>]
//
// Source: read-only SQL (BEGIN READ ONLY, default_transaction_read_only=on) through `docker exec` into the
// fixed container supabase_db_makeborne-release-auth, as the local postgres superuser over the container's own
// socket: no password exists in this process and nothing is printed but the result. Project images are read with
// `cat` from the stack's own storage container (supabase_storage_makeborne-release-auth) and must match their
// recorded sha256. The tool refuses any other container, a Docker endpoint that is not the local engine, or a
// container that is not labelled as the makeborne-release-auth project. There is no flag to point it elsewhere.
//
// Compile mode: publish. The saved source is bundled in Node by the app's own bundler (buildPublishBundle, via
// scripts/eval/lib/website.mjs compileWebsite, with responsive image copies), fonts are delivered as files like
// the trusted build (trustedFontDelivery), and the module + stylesheet are served at content-addressed /_mb/ paths
// under the published site's real CSP. Preview mode is not used because it adds the editor shim (postMessage
// bridge, hash-navigation relay, inline <script>), which visitors never run and which the published CSP
// (script-src 'self') would block: verifying it would test the editor, not the site customers get.
// Known gap: visitors first see the prerendered snapshot before the module runs; this verifies the live module.
//
// Output: report.json and screenshots in a fresh folder under the OS temp directory (or --out, never under
// outputs/). No provider, cloud or paid call; Chromium cannot reach any network (see isolated-chromium.mjs).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STACK = Object.freeze({ project: "makeborne-release-auth", db: "supabase_db_makeborne-release-auth", storage: "supabase_storage_makeborne-release-auth", dbPort: "55438", bucket: "project-assets" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const emit = process.emitWarning;
process.emitWarning = function quiet(warning, ...rest) {
  const code = typeof rest[0] === "object" ? rest[0]?.code : rest[1];
  if (code === "MODULE_TYPELESS_PACKAGE_JSON") return;
  return emit.call(this, warning, ...rest);
};

const option = name => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : undefined; };
const fail = message => { console.error(`verify-site: ${message}`); process.exit(2); };
const sha256 = value => createHash("sha256").update(value).digest("hex");

function docker(args, { input, binary = false } = {}) {
  const result = spawnSync("docker", args, { input, encoding: binary ? "buffer" : "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (result.error) fail(`docker could not run (${result.error.code ?? result.error.message})`);
  if (result.status !== 0) fail(`docker ${args[0]} failed: ${String(result.stderr).trim().split(/\r?\n/).slice(-2).join(" ").slice(0, 300)}`);
  return result.stdout;
}

/** Refuse anything but the isolated local release-auth stack on the local Docker engine. */
function assertIsolatedStack() {
  const host = process.env.DOCKER_HOST;
  if (host && !/^(?:npipe|unix):\/\//.test(host)) fail(`refused: DOCKER_HOST=${host.split(":")[0]}:… is not the local Docker engine`);
  const endpoint = docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]).trim();
  if (!/^(?:npipe|unix):\/\//.test(endpoint)) fail("refused: the current Docker context is not the local engine");
  for (const container of [STACK.db, STACK.storage]) {
    const [labels, running] = docker(["inspect", "--format", "{{json .Config.Labels}}\t{{.State.Running}}", container]).trim().split("\t");
    const parsed = JSON.parse(labels);
    if (parsed["com.supabase.cli.project"] !== STACK.project || parsed["com.docker.compose.project"] !== STACK.project) fail(`refused: ${container} is not labelled as the ${STACK.project} stack`);
    if (running !== "true") fail(`refused: ${container} is not running`);
  }
  const ports = JSON.parse(docker(["inspect", "--format", "{{json .NetworkSettings.Ports}}", STACK.db]));
  if (!(ports["5432/tcp"] ?? []).some(binding => binding.HostPort === STACK.dbPort)) fail(`refused: ${STACK.db} does not publish the isolated stack's port ${STACK.dbPort}`);
}

/** One read-only query; the row is JSON text. */
function readOnlySql(query) {
  const out = docker(["exec", "-i", "-e", "PGOPTIONS=-c default_transaction_read_only=on", STACK.db, "psql", "-X", "-q", "-A", "-t", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    { input: `BEGIN READ ONLY;\n${query};\nCOMMIT;\n` }).trim();
  return out ? JSON.parse(out) : null;
}

async function main() {
  const artifact = option("artifact"), versionArg = option("version");
  if (!artifact || !UUID.test(artifact)) fail("--artifact <uuid> is required");
  if (versionArg !== undefined && !/^[1-9]\d{0,5}$/.test(versionArg)) fail("--version must be a positive integer");
  const out = path.resolve(option("out") ?? mkdtempSync(path.join(tmpdir(), `makeborne-verify-${artifact.slice(0, 8)}-`)));
  const fromOutputs = path.relative(path.join(REPO, "outputs"), out);
  if (!fromOutputs.startsWith("..") && !path.isAbsolute(fromOutputs)) fail("refused: reports and screenshots never go under outputs/");
  assertIsolatedStack();

  const record = readOnlySql(`select json_build_object('artifactId', a.id, 'title', a.title, 'kind', a.kind, 'workspaceId', a.workspace_id, 'currentVersion', a.current_version,
    'version', v.version_number, 'versionId', v.id, 'createdAt', v.created_at, 'source', v.content->'websiteSource')::text
    from public.artifacts a join public.artifact_versions v on v.artifact_id = a.id and v.version_number = ${versionArg ? Number(versionArg) : "a.current_version"}
    where a.id = '${artifact}'`);
  if (!record) fail(`no saved version ${versionArg ?? "(current)"} of artifact ${artifact} on the isolated stack`);
  if (record.kind !== "website" || !record.source) fail(`artifact ${artifact} version ${record.version} is not a saved website source`);

  const { asWebsiteSource, compileWebsite, buildIndexHtml, trustedFontDelivery } = await import(pathToFileURL(path.join(REPO, "scripts/eval/lib/website.mjs")).href);
  const { loadApp } = (await import("node:module")).createRequire(import.meta.url)("./eval/lib/app-modules.cjs");
  const { verifySite } = await import(pathToFileURL(path.join(REPO, "infra/project-runtime/site-verifier.mjs")).href);
  const source = asWebsiteSource(record.source);
  const input = Object.fromEntries(source.files.filter(file => !/^package(-lock)?\.json$/.test(file.path)).map(file => [file.path, file.content]));
  const sourceRevision = `sha256:${sha256(loadApp("src/lib/builder/preview-revision.ts").previewFileRevision(input))}`;

  // Project images: the recorded asset rows of this workspace, bytes from the stack's storage, sha256-checked.
  const ids = source.assets.map(asset => asset.id).filter(id => UUID.test(id));
  const rows = ids.length ? readOnlySql(`select coalesce(json_agg(json_build_object('id', a.id, 'objectPath', a.object_path, 'sha256', a.sha256, 'contentType', a.content_type, 'storageVersion', o.version)), '[]')::text
    from public.assets a left join storage.objects o on o.bucket_id = '${STACK.bucket}' and o.name = a.object_path
    where a.workspace_id = '${record.workspaceId}' and a.id in (${ids.map(id => `'${id}'`).join(",")})`) : [];
  const env = docker(["exec", STACK.storage, "sh", "-c", 'printf "%s\\n%s\\n%s" "$FILE_STORAGE_BACKEND_PATH" "$TENANT_ID" "$GLOBAL_S3_BUCKET"']).split("\n").map(value => value.trim());
  const files = [], missing = [];
  for (const asset of source.assets) {
    const row = rows.find(item => item.id === asset.id);
    const safe = row && /^[0-9a-f-]+\/[0-9a-f-]+\/artwork\/[0-9a-f-]+\.(?:webp|png|jpe?g)$/i.test(row.objectPath) && UUID.test(row.storageVersion ?? "");
    let bytes = null;
    if (safe) for (const base of [`${env[0]}/${env[1]}/${env[2]}`, `${env[0]}/${env[2]}/${env[1]}`]) {
      const result = spawnSync("docker", ["exec", STACK.storage, "cat", `${base}/${STACK.bucket}/${row.objectPath}/${row.storageVersion}`], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024, windowsHide: true });
      if (result.status === 0) { bytes = result.stdout; break; }
    }
    if (!bytes || sha256(bytes) !== asset.sha256) { missing.push(asset.path); continue; }
    files.push({ path: `/${asset.path.replace(/^public\//, "")}`, contentType: asset.mediaType ?? row.contentType, body: bytes });
  }

  let compiled = await compileWebsite(source), compileMode = "publish (buildPublishBundle)";
  if (!compiled.ok && /Cannot find "[^"]+\.(?:webp|png|jpe?g|gif)"/i.test(compiled.error)) {
    // buildPublishBundle() takes no artwork, so a source that imports an image module only compiles the way the
    // editor preview compiles it. Same bundler in publish mode (minified, no editor shim) with only the imported
    // images as artwork (data URLs, as publish-snapshot.ts loadProject() passes them); every other image stays a
    // served file. The inline module and stylesheet are moved to files so the published CSP still applies.
    const imported = new Set();
    for (const file of source.files) for (const match of String(file.content).matchAll(/\bimport\s+[\w$]+\s+from\s+["']([^"']+\.(?:webp|png|jpe?g|gif))["']/gi)) {
      imported.add(path.posix.normalize(path.posix.join(path.posix.dirname(file.path), match[1])).replace(/^\/+/, ""));
    }
    const artwork = Object.fromEntries(files.filter(file => imported.has(file.path.slice(1))).map(file => [file.path, `data:${file.contentType};base64,${file.body.toString("base64")}`]));
    const bundled = await loadApp("src/lib/builder/browser-bundler.ts").bundleProject(input, artwork, "publish");
    if (!bundled.ok) fail(`the saved source does not compile: ${bundled.error}`);
    const js = /<script type="module">([\s\S]*)<\/script>/.exec(bundled.html)?.[1], cssText = /<style data-makeborne-bundle>([\s\S]*?)<\/style>/.exec(bundled.html)?.[1];
    if (js === undefined || cssText === undefined) fail("the publish bundle has no module script or stylesheet");
    compiled = { ok: true, js, css: cssText.replace(/<\\\/style/gi, "</style"), staticProblems: compiled.staticProblems };
    compileMode = `publish (bundleProject with ${Object.keys(artwork).length} imported image(s) as artwork; no responsive srcset)`;
  }
  if (!compiled.ok) fail(`the saved source does not compile: ${compiled.error}`);
  let { css } = compiled, fonts = [];
  try { ({ css, files: fonts } = trustedFontDelivery(source, compiled.css)); } catch (error) { console.log(`note: fonts stay embedded in the stylesheet (${error.message})`); }
  const script = `/_mb/app-${sha256(compiled.js).slice(0, 16)}.js`, style = `/_mb/app-${sha256(css).slice(0, 16)}.css`;
  files.push({ path: script, contentType: "text/javascript; charset=utf-8", body: Buffer.from(compiled.js) }, { path: style, contentType: "text/css; charset=utf-8", body: Buffer.from(css) });
  for (const font of fonts) files.push({ path: font.url, contentType: "font/woff2", body: readFileSync(font.file) });
  const indexHtml = buildIndexHtml(source).replace('href="/site.css"', `href="${style}"`).replace('src="/site.js"', `src="${script}"`);

  const viewports = option("viewports")?.split(",").map(value => { const [width, height] = value.split("x").map(Number); return { width, height }; });
  const only = option("only")?.split(",").map(value => value.trim()).filter(Boolean);
  const identity = { artifactId: record.artifactId, version: record.version, versionId: record.versionId, title: record.title, sourceRevision, ...(option("digest") ? { publicationDigest: option("digest") } : {}) };
  console.log(`Verifying "${record.title}" v${record.version}${record.version !== record.currentVersion ? ` (current is v${record.currentVersion})` : ""}: ${source.files.length} source files, ${source.routes.length} route(s), ${files.length} served files${missing.length ? `, ${missing.length} image(s) unavailable: ${missing.join(", ")}` : ""}. Compile mode: ${compileMode}.`);
  mkdirSync(out, { recursive: true });
  const report = await verifySite({ identity, site: { indexHtml, files }, routes: source.routes, viewports, only,
    limits: { timeMs: Number(option("time-ms") ?? 300_000), maxSteps: Number(option("max-steps") ?? 4000) }, evidenceDir: path.join(out, "shots") });
  report.source = { compileMode, staticProblems: compiled.staticProblems, unavailableImages: missing, files: files.map(file => ({ path: file.path, bytes: file.body.length, sha256: sha256(file.body) })) };
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));

  const { passed, failed, not_checked: notChecked } = report.summary;
  console.log(`\n${passed} passed, ${failed} failed, ${notChecked} not checked in ${Math.round(report.budget.elapsedMs / 1000)} s (${report.budget.steps} steps${report.budget.stopped ? `, stopped by the ${report.budget.stopped} budget` : ""}); ${report.violations.length} violation(s).`);
  for (const result of report.results.filter(item => item.status === "failed")) console.log(`FAIL ${result.id}\n     ${String(result.observed).slice(0, 400)}`);
  const reasons = new Map();
  for (const result of report.results.filter(item => item.status === "not_checked")) reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
  for (const [reason, count] of reasons) console.log(`not checked ×${count}: ${reason}`);
  for (const violation of report.violations) console.log(`VIOLATION ${violation.kind} ${violation.url} (${violation.route} ${violation.viewport})`);
  console.log(`\nReport: ${path.join(out, "report.json")}\nScreenshots: ${path.join(out, "shots")}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
