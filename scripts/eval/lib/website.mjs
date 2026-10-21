// Website pipeline: a saved WebsiteProjectSource becomes measurable pages, built
// with the app's own code so the eval measures what customers get.
//
//   build/      index.html + site.css + site.js.bundle (served at /site.js):
//               the production bundle from buildPublishBundle(), i.e. W1.
//   snapshot/   the static first paint, captured exactly like the app's
//               captureStaticSnapshot() (preview bundle + PREVIEW_SHIM in an
//               off-screen sandboxed 1280x900 iframe), then sanitised with
//               renderHostedSnapshot(). Self-contained (CSS and images inline,
//               no scripts): the portable / no-JS copy.
//   published/  what a visitor of a published interactive site loads first:
//               the sanitised snapshot with the stylesheet linked
//               (renderHostedSnapshot `stylesheets`) and the module script and
//               badge attached by the site Worker (composeSiteDocument()).
//
// Nothing here calls a provider or a database. CLI: --selftest (see bottom).
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { REPO, OUT, ensureDir, readJson, writeJson, rel } from './paths.mjs';
import { serve } from './serve.mjs';
import { HEIGHTS } from './thresholds.mjs';

const require = createRequire(import.meta.url);
const { loadApp } = require('./app-modules.cjs');
const ts = require(path.join(REPO, 'node_modules', 'typescript'));

const SCRIPT_TYPE = 'text/javascript; charset=utf-8';
const ms = since => Math.round(performance.now() - since);

// ---------------------------------------------------------------- app code

let app = null;
/** The app's own modules, loaded once (transpiled from src/ by app-modules.cjs). */
function appModules() {
  app ??= {
    bundler: loadApp('src/lib/builder/browser-bundler.ts'),
    files: loadApp('src/lib/builder/files.ts'),
    fonts: loadApp('src/lib/builder/fonts.ts'),
    hosting: loadApp('src/lib/hosting/snapshot.ts'),
    seo: loadApp('src/lib/hosting/seo.ts'),
  };
  return app;
}

let policy = null;
/** The site Worker's delivery policy (infra/customer-sites/site-policy.js). The
 * file is ESM in a package without "type"; Node detects that and warns once,
 * which is noise here, so only that one warning is muted during the import. */
async function sitePolicy() {
  if (policy) return policy;
  const emit = process.emitWarning;
  process.emitWarning = function quiet(warning, ...rest) {
    const code = typeof rest[0] === 'object' ? rest[0]?.code : rest[1];
    if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
    return emit.call(this, warning, ...rest);
  };
  try { policy = await import(pathToFileURL(path.join(REPO, 'infra', 'customer-sites', 'site-policy.js')).href); }
  finally { process.emitWarning = emit; }
  return policy;
}

// esbuild-wasm under Node runs its Go service in a child process that decides
// once, during its first build request, whether it is on Windows (an
// os.Stat("C:\\") that is asynchronous inside wasm). A second request that
// arrives while that check is pending sees "not Windows" and rejects the
// Windows working directory: 'The working directory "C:\..." is not an
// absolute path' (reproduced: two or more cold concurrent buildPublishBundle()
// calls fail all but one; serial or warm concurrent calls pass). So the first
// bundler request of the process is a warm-up build that runs alone, and every
// bundler entry in this file (compileWebsite, the preview bundle in
// materializeWebsite) waits for it; afterwards calls run concurrently. If the
// service is restarted (a crashed child process is respawned cold) and the
// race shows up again, the call warms the new service up and retries once.
const BUNDLER_RACE = /working directory .* is not an absolute path/i;
const WARM_UP_INPUT = Object.freeze({ 'src/main.tsx': 'document.title = "warm-up";\n' });
let bundlerWarm = null;

function warmBundler() {
  bundlerWarm ??= appModules().bundler.buildPublishBundle({ ...WARM_UP_INPUT }).then(() => true, () => false);
  return bundlerWarm;
}

/**
 * Run one bundler call once the service is warm. The cold-start race is
 * recognised both as a thrown error (buildPublishBundle) and as a returned
 * {ok: false, error} (bundleProject); any other outcome is returned as is.
 */
async function withWarmBundler(call) {
  const gate = warmBundler();
  await gate;
  const raced = outcome => BUNDLER_RACE.test(String(outcome?.message ?? outcome?.error ?? ''));
  let result;
  try { result = await call(); }
  catch (error) {
    if (!raced(error)) throw error;
    if (bundlerWarm === gate) bundlerWarm = null;
    await warmBundler();
    return call();
  }
  if (result?.ok === false && raced(result)) {
    if (bundlerWarm === gate) bundlerWarm = null;
    await warmBundler();
    return call();
  }
  return result;
}

/** Accept a WebsiteProjectSource, a saved content object, or a version array. */
export function asWebsiteSource(value) {
  const version = Array.isArray(value) ? value[0] : value;
  const source = version?.content?.websiteSource ?? version?.websiteSource ?? version;
  if (!source || !Array.isArray(source.files)) throw new Error('Not a WebsiteProjectSource: files[] missing');
  return { ...source, assets: source.assets ?? [], routes: source.routes ?? [{ path: '/', title: 'Home' }] };
}

/** Bundler input exactly as publish-snapshot.ts loadProject() builds it. */
const bundleInput = source => Object.fromEntries(source.files
  .filter(file => !/^package(-lock)?\.json$/.test(file.path)).map(file => [file.path, file.content]));

/** Public path the site code references for a source asset (loadProject()). */
const assetUrl = asset => `/${asset.path.replace(/^public\//, '')}`;

// ---------------------------------------------------------------- 1. compile

/**
 * W1: the app's production bundle (buildPublishBundle: esbuild-wasm, React
 * inlined from public/builder-runtime, fonts embedded as base64 @font-face),
 * plus the static checks finish() runs (ProjectFiles.problems()).
 */
export async function compileWebsite(sourceInput) {
  const source = asWebsiteSource(sourceInput);
  const { bundler, files } = appModules();
  let staticProblems;
  try { staticProblems = new files.ProjectFiles(source).problems(); }
  catch (error) { staticProblems = [`ProjectFiles.problems() failed: ${error.message}`]; }
  await warmBundler(); // so `ms` is this project's build, not the one-off warm-up wait
  const started = performance.now();
  try {
    const { js, css } = await withWarmBundler(() => bundler.buildPublishBundle(bundleInput(source)));
    return { ok: true, error: null, ms: ms(started), jsBytes: Buffer.byteLength(js), cssBytes: Buffer.byteLength(css), js, css, staticProblems };
  } catch (error) {
    const message = String(error?.message ?? error).replace(/^Fix the build before publishing: /, '');
    return { ok: false, error: message, ms: ms(started), jsBytes: 0, cssBytes: 0, js: null, css: null, staticProblems };
  }
}

// ---------------------------------------------------------------- 2. typecheck

// The exact options of the trusted runtime image (infra/project-runtime/build.mjs),
// which refuses to build a project with any diagnostic. The toolchain folder has
// no tsconfig. Types come from the app's node_modules (@types/react 19.3.0 here,
// 19.2.18 pinned in the toolchain; lucide-react 1.51.0 ships its own types).
export const TYPECHECK_OPTIONS = Object.freeze({
  strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: ['react', 'react-dom'],
  typeRoots: [path.join(REPO, 'node_modules', '@types')], allowImportingTsExtensions: true, resolveJsonModule: true,
});

// Parsed lib and node_modules declarations are shared between programs (like a
// language service's document registry): parsing lib.dom once saves seconds.
const declarationCache = new Map();
// A virtual folder inside the repo, so bare imports resolve to the repo's
// node_modules. Nothing is ever written there: the host serves it from memory.
const VIRTUAL_ROOT = path.join(REPO, '.eval-typecheck-virtual').split(path.sep).join('/');

/** W2: an in-memory TypeScript program over the project's .ts/.tsx files. */
export function typecheckWebsite(sourceInput) {
  const source = asWebsiteSource(sourceInput);
  const started = performance.now();
  const key = file => {
    const normal = path.resolve(file).split(path.sep).join('/');
    return ts.sys.useCaseSensitiveFileNames ? normal : normal.toLowerCase();
  };
  const virtualRoot = key(VIRTUAL_ROOT);
  const inside = file => key(file) === virtualRoot || key(file).startsWith(`${virtualRoot}/`);
  const project = source.files.filter(file => /\.[cm]?tsx?$/.test(file.path));
  const memory = new Map(source.files.map(file => [key(`${VIRTUAL_ROOT}/${file.path}`), file.content]));
  const folders = new Set([virtualRoot]);
  for (const file of source.files) {
    const parts = file.path.split('/');
    for (let length = 1; length < parts.length; length++) folders.add(key(`${VIRTUAL_ROOT}/${parts.slice(0, length).join('/')}`));
  }
  const host = ts.createCompilerHost(TYPECHECK_OPTIONS, true);
  host.getCurrentDirectory = () => VIRTUAL_ROOT;
  host.writeFile = () => {};
  host.realpath = file => file;
  host.fileExists = file => memory.has(key(file)) || (!inside(file) && ts.sys.fileExists(file));
  host.readFile = file => memory.get(key(file)) ?? (inside(file) ? undefined : ts.sys.readFile(file));
  host.directoryExists = folder => folders.has(key(folder)) || (!inside(folder) && ts.sys.directoryExists(folder));
  host.getDirectories = folder => (inside(folder) ? [] : ts.sys.getDirectories(folder));
  host.getSourceFile = (fileName, languageVersion, onError) => {
    const content = memory.get(key(fileName));
    if (content !== undefined) return ts.createSourceFile(fileName, content, languageVersion, true);
    if (inside(fileName)) return undefined;
    const cacheKey = `${key(fileName)}|${JSON.stringify(languageVersion)}`;
    if (!declarationCache.has(cacheKey)) {
      const text = ts.sys.readFile(fileName);
      if (text === undefined) { onError?.(`Cannot read ${fileName}`); return undefined; }
      declarationCache.set(cacheKey, ts.createSourceFile(fileName, text, languageVersion, true));
    }
    return declarationCache.get(cacheKey);
  };
  const program = ts.createProgram(project.map(file => `${VIRTUAL_ROOT}/${file.path}`), TYPECHECK_OPTIONS, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const errors = diagnostics.map(diagnostic => {
    const file = diagnostic.file ? path.posix.relative(VIRTUAL_ROOT, diagnostic.file.fileName.split(path.sep).join('/')) : null;
    const line = diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : null;
    return { file, line, code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') };
  });
  return { ok: errors.length === 0, count: errors.length, errors, files: project.length, ms: ms(started) };
}

// ---------------------------------------------------------------- 3. build

const DEFAULT_INDEX = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Website</title></head><body><div id="root"></div></body></html>';

/** The project's index.html with its module entry and stylesheet links stripped
 * (the same expressions bundleProject() uses), pointing at /site.css and /site.js
 * where bundleProject() inlines the compiled style and script. */
export function buildIndexHtml(sourceInput) {
  const source = asWebsiteSource(sourceInput);
  let html = (source.files.find(file => file.path === 'index.html')?.content ?? DEFAULT_INDEX)
    .replace(/<script\b[^>]*\bsrc=["'][^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<link\b[^>]*rel=["']?(?:modulepreload|stylesheet)["']?[^>]*>/gi, '');
  if (!/<\/head>/i.test(html)) html = html.replace(/<body/i, '<head></head><body');
  html = html.replace(/<\/head>/i, () => '<link rel="stylesheet" href="/site.css"></head>');
  const script = '<script type="module" src="/site.js"></script>';
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => `${script}</body>`) : `${html}${script}`;
}

/**
 * Source assets carry no bytes. An item folder may hold them in assets/, under
 * the asset path, the path without public/, the file name or the asset id.
 * A file whose sha256 differs from the source record counts as missing.
 */
export function resolveAssets(sourceInput, itemDir) {
  const source = asWebsiteSource(sourceInput);
  const found = [], missingAssets = [];
  const folder = itemDir ? path.join(itemDir, 'assets') : null;
  for (const asset of source.assets) {
    const extension = path.extname(asset.path);
    const candidates = folder && existsSync(folder) ? [asset.path, asset.path.replace(/^public\//, ''), path.basename(asset.path), `${asset.id}${extension}`, asset.id]
      .map(name => path.resolve(folder, name)).filter(file => file.startsWith(folder + path.sep)) : [];
    const file = candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile());
    const bytes = file ? readFileSync(file) : null;
    const intact = bytes && (!/^[a-f0-9]{64}$/.test(asset.sha256 ?? '') || createHash('sha256').update(bytes).digest('hex') === asset.sha256);
    if (intact) found.push({ path: asset.path, url: assetUrl(asset), file, bytes, mediaType: asset.mediaType ?? 'application/octet-stream' });
    else missingAssets.push(asset.path);
  }
  return { found, missingAssets };
}

// Font delivery of the "published" page. Source websites publish only through the trusted
// Vite build (src/components/website-publish.tsx renders TrustedWebsitePublish; the browser
// bundle's CSS is never hosted): infra/project-runtime/font-portability.cjs links the same
// fontFaceRule() rules and build.mjs sets assetsInlineLimit 0, so every woff2 is its own
// /assets/ file. 'trusted' (default since QUALITY_BAR v1.3) reproduces that with the runtime
// woff2 copies (byte-identical to the pinned @fontsource 5.3.0 files); 'bundle' keeps
// buildPublishBundle()'s base64 @font-face rules inside the stylesheet (the v1.0-1.2 model,
// which is what the studio preview and client review snapshots still carry).
// Contributed by the Phase 2 platform session (H1'), adopted as an instrument change.
export const FONT_DELIVERY = process.env.EVAL_FONT_DELIVERY === 'bundle' ? 'bundle' : 'trusted';
const EMBEDDED_FONT_RULES = /^(?:@font-face\{[^{}]*url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\("woff2"\)(?:;unicode-range:[^{}]+)?\}\n)+/;

/** compiled.css with its embedded font rules replaced by file-backed ones, plus the font files to serve.
 * Like the portable build, every style links both its latin-ext and latin files (fetched by unicode-range). */
export function trustedFontDelivery(sourceInput, css) {
  const { fonts: fontModule } = appModules();
  const { fonts, italic } = fontModule.detectFonts(Object.entries(bundleInput(asWebsiteSource(sourceInput))));
  const styles = fonts.flatMap(font => (italic && font.italic ? ['normal', 'italic'] : ['normal']).map(style => ({ font, style })));
  const embedded = EMBEDDED_FONT_RULES.exec(css)?.[0] ?? '';
  const embeddedStyles = new Set([...embedded.matchAll(/font-family:"([^"]+)";font-style:(\w+)/g)].map(match => `${match[1]}:${match[2]}`));
  if (embeddedStyles.size !== styles.length) throw new Error(`font delivery: ${embeddedStyles.size} embedded style(s) but ${styles.length} detected style(s)`);
  if (!styles.length) return { css, files: [] };
  const faces = styles.flatMap(({ font, style }) => fontModule.FONT_SUBSETS.map(subset => ({ font, style, subset })));
  const files = faces.map(({ font, style, subset }) => ({
    url: `/assets/${font.id}-${subset}-${font.axis}-${style}.woff2`,
    file: path.join(REPO, 'public', 'builder-runtime', 'fonts', fontModule.fontFileName(font, style, subset)),
  }));
  const rules = faces.map(({ font, style, subset }, index) => fontModule.fontFaceRule(font, style, files[index].url, subset)).join('\n');
  return { css: `${rules}\n${css.slice(embedded.length)}`, files };
}

/** Write dir/build/{index.html, site.css, site.js.bundle} plus found assets at their public paths. */
export function writeBuild(dir, sourceInput, compiled, { itemDir, assets } = {}) {
  const source = asWebsiteSource(sourceInput);
  const resolved = assets ?? resolveAssets(source, itemDir);
  const build = path.join(dir, 'build');
  rmSync(build, { recursive: true, force: true });
  if (!compiled?.ok) return { ok: false, dir: null, missingAssets: resolved.missingAssets };
  ensureDir(build);
  writeFileSync(path.join(build, 'index.html'), buildIndexHtml(source));
  writeFileSync(path.join(build, 'site.css'), compiled.css);
  writeFileSync(path.join(build, 'site.js.bundle'), compiled.js);
  for (const font of compiled.fontFiles ?? []) {
    ensureDir(path.dirname(path.join(build, `.${font.url}`)));
    copyFileSync(font.file, path.join(build, `.${font.url}`));
  }
  for (const asset of resolved.found) {
    const target = path.resolve(build, `.${asset.url}`);
    if (!target.startsWith(build + path.sep) || /\.(?:[cm]?[jt]sx?|[cm]ts)$/i.test(target)) continue; // lint-safe outputs
    ensureDir(path.dirname(target));
    copyFileSync(asset.file, target);
  }
  return { ok: true, dir: build, missingAssets: resolved.missingAssets };
}

// ---------------------------------------------------------------- 4. serve

/** Every file of build/ at its public path, with site.js.bundle as /site.js. */
export function buildAliases(dir) {
  const build = path.join(dir, 'build');
  const aliases = {};
  const walk = folder => {
    if (!existsSync(folder)) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      const url = `/${path.relative(build, file).split(path.sep).join('/')}`;
      if (url === '/index.html') continue;
      if (url === '/site.js.bundle') aliases['/site.js'] = { file, type: SCRIPT_TYPE };
      else aliases[url] = { file };
    }
  };
  walk(build);
  return aliases;
}

/**
 * Serve one variant (build | snapshot | published) of a materialised item dir.
 * /site.js, /site.css and project images always come from build/. With
 * `hostHeaders` (default) responses carry the site Worker's real headers: the
 * document CSP (script-src 'self', interactive unless the variant is the static
 * snapshot), frame denial and the hosted cache policy. Pass false to embed the
 * pages in an iframe (the host forbids framing).
 */
export async function serveWebsite(dir, { variant = 'published', hostHeaders = true, port = 0, log } = {}) {
  if (!['build', 'snapshot', 'published'].includes(variant)) throw new Error(`Unknown website variant ${variant}`);
  const root = path.join(dir, variant);
  if (!existsSync(path.join(root, 'index.html'))) throw new Error(`Nothing to serve: ${rel(root)}/index.html is missing`);
  let headers;
  if (hostHeaders) {
    const site = await sitePolicy();
    const interactive = variant !== 'snapshot';
    headers = ({ pathname, type, document }) => (document
      ? site.siteDocumentHeaders({ interactive, secure: false, indexable: true })
      : site.siteFileHeaders({ pathname, contentType: type, secure: false }));
  }
  return serve(root, { port, log, aliases: buildAliases(dir), headers });
}

/** The served build (what W1-W14 instruments run against before publishing). */
export const serveBuild = (dir, options = {}) => serveWebsite(dir, { ...options, variant: 'build' });

// ---------------------------------------------------------------- 5. snapshot

// Runs in a blank host page. Mirrors captureStaticSnapshot() line for line: the
// preview bundle (with the app's PREVIEW_SHIM) in an off-screen sandboxed
// iframe; on "ready" the host waits 600 ms and asks for the snapshot; the shim
// scrolls in steps of max(300, innerHeight*0.6) every 60 ms, returns to the
// top, waits 900 ms and posts the cleaned documentElement.
const FRAME_CAPTURE = ({ html, timeoutMs }) => new Promise((resolve, reject) => {
  const frame = document.createElement('iframe');
  const errors = [];
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '1280px', height: '900px', border: '0', opacity: '0', pointerEvents: 'none' });
  const finish = (error, snapshot) => {
    clearTimeout(timer); window.removeEventListener('message', listen); frame.remove();
    if (error) reject(error); else resolve({ html: snapshot, errors });
  };
  const timer = setTimeout(() => finish(new Error('The website took too long to render for publishing.')), timeoutMs);
  const listen = event => {
    if (event.source !== frame.contentWindow || event.data?.source !== 'makeborne-preview') return;
    if (event.data.type === 'runtime-error') errors.push(String(event.data.message).slice(0, 500));
    if (event.data.type === 'ready') setTimeout(() => frame.contentWindow?.postMessage({ source: 'makeborne-host', type: 'snapshot' }, '*'), 600);
    if (event.data.type === 'snapshot') finish(null, String(event.data.html));
  };
  window.addEventListener('message', listen);
  frame.srcdoc = html;
  document.body.appendChild(frame);
});

// The same procedure on a served page (top level, no sandbox). Linked
// stylesheets are inlined as the bundle <style> the preview document carries.
const PAGE_CAPTURE = async () => {
  const wait = delay => new Promise(resolve => setTimeout(resolve, delay));
  const styles = await Promise.all([...document.querySelectorAll('link[rel="stylesheet"][href]')]
    .map(async link => ({ href: link.getAttribute('href'), css: await fetch(link.href).then(response => response.text()) })));
  await wait(600);
  const height = document.documentElement.scrollHeight;
  for (let y = 0; y < height + innerHeight; y += Math.max(300, innerHeight * 0.6)) { scrollTo(0, y); await wait(60); }
  scrollTo(0, 0);
  await wait(900);
  const clone = document.documentElement.cloneNode(true);
  for (const link of clone.querySelectorAll('link[rel="stylesheet"][href]')) {
    const found = styles.find(item => item.href === link.getAttribute('href'));
    if (!found) continue;
    const style = document.createElement('style');
    style.setAttribute('data-makeborne-bundle', '');
    style.textContent = found.css;
    link.replaceWith(style);
  }
  clone.querySelectorAll('script,noscript,template,iframe,object,embed').forEach(node => node.remove());
  clone.classList.remove('js');
  return `<!doctype html>${clone.outerHTML}`;
};

const loopback = url => /^(?:data|blob|about):/.test(url) || ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);

/**
 * Capture the raw snapshot ('<!doctype html>...', scripts and the js class
 * removed, CSS inline in <style data-makeborne-bundle>). With `previewHtml`
 * (bundleProject(files, assets, 'preview').html) this is the app's own
 * procedure in a sandboxed frame; with only `url` the procedure runs top level
 * on the served build at 1280x900. Requests leaving 127.0.0.1 are blocked and
 * reported (the app would let the browser try them).
 */
export async function captureRawSnapshot({ browser, url, previewHtml, timeoutMs = 30_000 }) {
  if (!browser) throw new Error('captureRawSnapshot needs a Playwright browser');
  if (!previewHtml && !url) throw new Error('captureRawSnapshot needs previewHtml or url');
  const started = performance.now();
  const frame = Boolean(previewHtml);
  const context = await browser.newContext({ viewport: frame ? { width: 1440, height: 900 } : { width: 1280, height: 900 } });
  const blockedRequests = [], pageErrors = [];
  try {
    await context.route('**/*', route => {
      if (loopback(route.request().url())) return route.continue();
      blockedRequests.push(route.request().url().slice(0, 200));
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message.slice(0, 500)));
    let html;
    if (frame) {
      await page.setContent('<!doctype html><html lang="en"><head><title>Capture</title></head><body></body></html>');
      const result = await page.evaluate(FRAME_CAPTURE, { html: previewHtml, timeoutMs });
      html = result.html;
      pageErrors.push(...result.errors);
    } else {
      await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
      await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0, null, { timeout: 15_000 }).catch(() => {});
      html = await page.evaluate(PAGE_CAPTURE);
    }
    return { html, procedure: frame ? 'app-frame' : 'served-page', ms: ms(started), runtimeErrors: [...new Set(pageErrors)], blockedRequests };
  } finally {
    await context.close();
  }
}

const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BUNDLE_STYLE = /<style\b[^>]*\bdata-makeborne-bundle\b[^>]*>[\s\S]*?<\/style>/gi;
// composeSiteDocument() only accepts content-addressed entry paths; the eval
// serves the same bytes at /site.js, so a placeholder is swapped afterwards.
const SCRIPT_PLACEHOLDER = '/_mb/app-0000000000000000.js';

/**
 * Turn a raw snapshot into the two hosted documents, the way the trusted
 * publication output composes them (publication-output.ts) and the Worker
 * serves them (_worker.js + composeSiteDocument):
 * - snapshot: portable copy, CSS inline, images as data URLs, no scripts;
 * - published: CSS linked at /site.css, images at their public paths, the
 *   module script /site.js in <head>, and the "Made with Makeborne" badge
 *   (on by default for every workspace).
 * Title and description come from the app's pageMeta(); `description` is the
 * worker's fallback (it passes the site title, which is the default here).
 */
export async function hostedDocuments(raw, { title, description: fallback, address, seo, routes, assets = [], css = '', branding = true }) {
  const { hosting, seo: seoModule } = appModules();
  const site = await sitePolicy();
  const origin = address.replace(/\/$/, '');
  const assetPaths = new Set(assets.map(asset => asset.url));
  const shareImage = seo?.shareImage && assetPaths.has(seo.shareImage) ? `${origin}${seo.shareImage}` : undefined;
  const meta = seoModule.pageMeta({ path: '/', routeTitle: routes?.find(route => route.path === '/')?.title, siteTitle: title, html: raw, seo });
  const description = meta.description || fallback || title;
  const head = { siteName: seo?.siteName || title, image: shareImage, jsonLd: seoModule.structuredData(seo, address, shareImage) };

  // Portable: every known asset reference becomes a data URL (as composePublicationOutput does).
  let portable = raw;
  for (const asset of assets) {
    const reference = new RegExp(`(["'(]\\s*)${escapePattern(asset.url)}(?=\\s*["')])`, 'g');
    portable = portable.replace(reference, (_match, lead) => `${lead}data:${asset.mediaType};base64,${asset.bytes.toString('base64')}`);
  }
  const snapshot = hosting.renderHostedSnapshot(portable, meta.title, description, address, { requireReactRoot: true, ...head });

  // Published: data URLs back to public paths (captureProjectPublication), the
  // inline bundle style replaced by the hosted stylesheet.
  let isolated = raw;
  for (const asset of assets) isolated = isolated.split(`data:${asset.mediaType};base64,${asset.bytes.toString('base64')}`).join(asset.url);
  const stylesheets = css.trim() ? ['/site.css'] : [];
  isolated = hosting.renderHostedSnapshot(isolated.replace(BUNDLE_STYLE, ''), meta.title, description, address,
    { assetPaths: new Set([...assetPaths, ...stylesheets]), stylesheets, requireReactRoot: true, ...head });
  const published = site.composeSiteDocument(isolated, { script: SCRIPT_PLACEHOLDER, interactive: true, branding })
    .replace(`src="${SCRIPT_PLACEHOLDER}"`, 'src="/site.js"');
  return { snapshot, published, meta: { title: meta.title, description } };
}

/**
 * Capture and sanitise in one call: returns the portable snapshot HTML (what
 * snapshot/index.html holds). See captureRawSnapshot() for the procedures.
 */
export async function captureSnapshot({ browser, url, previewHtml, title, description, address = 'https://site.makeborne.test/', seo, routes, assets, css }) {
  const raw = await captureRawSnapshot({ browser, url, previewHtml });
  return (await hostedDocuments(raw.html, { title, description, address, seo, routes, assets, css })).snapshot;
}

// ---------------------------------------------------------------- 6. materialise

const slugOf = value => String(value ?? 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 46) || 'site';
const dataUrl = asset => `data:${asset.mediaType};base64,${asset.bytes.toString('base64')}`;

/**
 * itemDir/source.json (+ item.json, optional assets/) → outDir/{build,snapshot,published}/.
 * Returns { ok, title, compile, typecheck, snapshot, paths, missingAssets, ms }.
 * A failed compile or snapshot is a result, not an exception.
 */
export async function materializeWebsite({ itemDir, outDir, browser, source: sourceInput, item: itemInput, address, branding = true, procedure = 'app-frame' }) {
  const started = performance.now();
  const source = asWebsiteSource(sourceInput ?? readJson(path.join(itemDir, 'source.json')));
  const item = itemInput ?? (itemDir && existsSync(path.join(itemDir, 'item.json')) ? readJson(path.join(itemDir, 'item.json')) : {});
  const title = item.title ?? source.routes.find(route => route.path === '/')?.title ?? 'Website';
  const siteAddress = address ?? `https://${slugOf(item.id ?? title)}.sites.makeborne.test/`;
  ensureDir(outDir);
  for (const variant of ['snapshot', 'published']) rmSync(path.join(outDir, variant), { recursive: true, force: true });

  const compiled = await compileWebsite(source);
  if (compiled.ok && FONT_DELIVERY === 'trusted') {
    const delivered = trustedFontDelivery(source, compiled.css);
    Object.assign(compiled, { css: delivered.css, cssBytes: Buffer.byteLength(delivered.css), fontFiles: delivered.files });
  }
  const typecheck = typecheckWebsite(source);
  const assets = resolveAssets(source, itemDir);
  const build = writeBuild(outDir, source, compiled, { assets });
  // The bundle text lives in build/; the result keeps only its measurements.
  const compile = { ok: compiled.ok, error: compiled.error, ms: compiled.ms, jsBytes: compiled.jsBytes, cssBytes: compiled.cssBytes, staticProblems: compiled.staticProblems,
    fontDelivery: FONT_DELIVERY, fontFiles: (compiled.fontFiles ?? []).map(font => font.url) };
  const result = {
    ok: false, title, address: siteAddress, compile, typecheck,
    snapshot: { ok: false, error: null, procedure, ms: null, runtimeErrors: [], blockedRequests: [], bytes: null, publishedBytes: null },
    paths: { build: build.dir, snapshot: null, published: null }, missingAssets: assets.missingAssets, ms: null,
  };
  if (!compiled.ok) {
    result.snapshot.error = 'not captured: the project does not compile';
    result.ms = ms(started);
    return result;
  }

  let ownBrowser = null, server = null;
  try {
    if (!browser) { const { chromium } = await import('playwright'); browser = ownBrowser = await chromium.launch({ headless: true }); }
    let raw;
    if (procedure === 'app-frame') {
      const previewStarted = performance.now();
      const preview = await withWarmBundler(() => appModules().bundler.bundleProject(bundleInput(source), Object.fromEntries(assets.found.map(asset => [asset.url, dataUrl(asset)])), 'preview'));
      if (!preview.ok) throw new Error(`preview bundle failed: ${preview.error}`);
      result.snapshot.previewMs = ms(previewStarted);
      raw = await captureRawSnapshot({ browser, previewHtml: preview.html });
    } else if (procedure === 'served-page') {
      server = await serveWebsite(outDir, { variant: 'build' });
      raw = await captureRawSnapshot({ browser, url: `${server.url}/` });
    } else throw new Error(`Unknown snapshot procedure ${procedure}`);
    Object.assign(result.snapshot, { ms: raw.ms, runtimeErrors: raw.runtimeErrors, blockedRequests: raw.blockedRequests });
    const documents = await hostedDocuments(raw.html, { title, address: siteAddress, seo: item.seo, routes: source.routes, assets: assets.found, css: compiled.css, branding });
    for (const [variant, html] of [['snapshot', documents.snapshot], ['published', documents.published]]) {
      ensureDir(path.join(outDir, variant));
      writeFileSync(path.join(outDir, variant, 'index.html'), html);
      result.paths[variant] = path.join(outDir, variant);
    }
    Object.assign(result.snapshot, { ok: true, bytes: Buffer.byteLength(documents.snapshot), publishedBytes: Buffer.byteLength(documents.published), meta: documents.meta });
    result.ok = true;
  } catch (error) {
    result.snapshot.error = String(error?.message ?? error).slice(0, 1000);
  } finally {
    await server?.close();
    await ownBrowser?.close();
  }
  result.ms = ms(started);
  return result;
}

// ---------------------------------------------------------------- 7. self-test

/** Load a served page the way a visitor does and report what rendered. */
async function renderCheck(browser, url, { width, javaScriptEnabled = true, shot }) {
  const context = await browser.newContext({ viewport: { width, height: HEIGHTS[width] ?? 900 }, javaScriptEnabled });
  const pageErrors = [], consoleErrors = [];
  try {
    await context.route('**/*', route => (loopback(route.request().url()) ? route.continue() : route.abort()));
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message.slice(0, 300)));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300)); });
    const response = await page.goto(url, { waitUntil: 'load' });
    // React 19 marks the container it renders into: proof the module bundle ran.
    if (javaScriptEnabled) await page.waitForFunction(() => Object.keys(document.getElementById('root') ?? {}).some(key => key.startsWith('__reactContainer$')), null, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(400);
    const facts = await page.evaluate(() => ({
      title: document.title,
      h1: [...document.querySelectorAll('h1')].map(node => node.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean),
      mounted: Object.keys(document.getElementById('root') ?? {}).some(key => key.startsWith('__reactContainer$')),
      overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      height: document.documentElement.scrollHeight,
    }));
    if (shot) { ensureDir(path.dirname(shot)); await page.screenshot({ path: shot }); }
    return { width, status: response?.status() ?? null, csp: Boolean(response?.headers()['content-security-policy']), ...facts, pageErrors, consoleErrors };
  } finally {
    await context.close();
  }
}

async function selftest() {
  const { chromium } = await import('playwright');
  const base = path.join(OUT, 'selftest', 'website');
  const browser = await chromium.launch({ headless: true });
  const summary = { startedAt: new Date().toISOString(), items: [] };
  try {
    for (const name of ['restaurant', 'saas', 'portfolio']) {
      const fixture = path.join(REPO, 'outputs', 'product-qualification', `${name}.json`);
      const versions = readJson(fixture);
      const content = versions[0].content;
      // Lay the fixture out like a run item so the file-based path is exercised.
      const itemDir = path.join(base, name, 'item'), outDir = path.join(base, name);
      writeJson(path.join(itemDir, 'source.json'), content.websiteSource);
      writeJson(path.join(itemDir, 'item.json'), { id: `selftest-${name}`, kind: 'website', title: content.title, direction: null, briefId: null, brief: null,
        origin: { type: 'fixture', stack: null, artifactId: null, version: versions[0].version_number ?? null, path: rel(fixture) } });
      const result = await materializeWebsite({ itemDir, outDir, browser });
      const checks = [];
      if (result.paths.published) {
        const server = await serveWebsite(outDir, { variant: 'published' });
        try {
          for (const width of [1440, 390]) checks.push({ variant: 'published', ...await renderCheck(browser, `${server.url}/`, { width, shot: path.join(outDir, 'shots', `selftest-published-${width}.png`) }) });
          const failed = server.requests.filter(request => request.status !== 200).map(request => request.path);
          checks.forEach(check => { check.failedRequests = failed; });
        } finally { await server.close(); }
        const snapshotServer = await serveWebsite(outDir, { variant: 'snapshot' });
        try { checks.push({ variant: 'snapshot-nojs', ...await renderCheck(browser, `${snapshotServer.url}/`, { width: 1440, javaScriptEnabled: false }) }); }
        finally { await snapshotServer.close(); }
      }
      const renders = checks.length === 3 && checks.every(check => check.status === 200 && check.h1.length > 0 && !check.pageErrors.length)
        && checks.filter(check => check.variant === 'published').every(check => check.mounted && !check.failedRequests.length);
      summary.items.push({
        name, title: result.title, ok: result.ok && renders, materializeMs: result.ms,
        compile: { ok: result.compile.ok, error: result.compile.error, ms: result.compile.ms, jsBytes: result.compile.jsBytes, cssBytes: result.compile.cssBytes, staticProblems: result.compile.staticProblems },
        typecheck: { ok: result.typecheck.ok, count: result.typecheck.count, ms: result.typecheck.ms, first: result.typecheck.errors.slice(0, 3) },
        snapshot: { ok: result.snapshot.ok, error: result.snapshot.error, procedure: result.snapshot.procedure, previewMs: result.snapshot.previewMs, captureMs: result.snapshot.ms,
          bytes: result.snapshot.bytes, publishedBytes: result.snapshot.publishedBytes, runtimeErrors: result.snapshot.runtimeErrors, blockedRequests: result.snapshot.blockedRequests },
        missingAssets: result.missingAssets,
        paths: Object.fromEntries(Object.entries(result.paths).map(([key, value]) => [key, value && rel(value)])),
        renders: checks.map(({ variant, width, status, csp, mounted, h1, overflowX, pageErrors, consoleErrors }) => ({ variant, width, status, csp, mounted, h1: h1.slice(0, 2), overflowX, pageErrors, consoleErrors })),
      });
    }
  } finally {
    await browser.close();
  }
  summary.ok = summary.items.every(item => item.ok);
  summary.finishedAt = new Date().toISOString();
  writeJson(path.join(base, 'summary.json'), summary);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href && process.argv.includes('--selftest')) {
  selftest().catch(error => { console.error(error); process.exitCode = 1; });
}
