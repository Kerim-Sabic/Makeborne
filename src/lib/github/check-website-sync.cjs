/* eslint-disable @typescript-eslint/no-require-imports -- Offline GitHub sync qualification against a mocked GitHub REST API. */
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), Module = require("node:module"), ts = require("typescript");
const {createHash} = require("node:crypto");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, filename);
// Any real network call fails the harness: every GitHub request goes through the injected mock.
globalThis.fetch = () => { throw new Error("Network access is not allowed in this offline check."); };

const {githubClient} = require("./api.ts");
const sync = require("./website-sync.ts");
const {githubSourceSnapshot, pushWebsiteSource, pushWebsiteSnapshot, githubLinkUrls, gitBlobSha, GITHUB_SOURCE_LIMITS, websiteBranch} = sync;
const {SourcePathSchema} = require("../projects/website-source.ts");
const root = path.resolve(__dirname, "../../..");
const packageJson = fs.readFileSync(path.join(root, "infra/project-runtime/toolchain/package.json"), "utf8");
const packageLock = fs.readFileSync(path.join(root, "infra/project-runtime/toolchain/package-lock.json"), "utf8");
const legacy = require("../../../infra/project-runtime/legacy-toolchain.json");

const artifactId = "60000000-0000-4000-8000-000000000001", assetId = "10000000-0000-4000-8000-000000000001";
const token = "test-token-not-a-secret";
const repository = "octo/site";
const branch = `makeborne/site-${artifactId}`;
// Deliberately not valid UTF-8 so base64 transport is required to keep the bytes exact.
const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x81, 0x00, 0x7f, 0xc3]);
const sha256 = value => createHash("sha256").update(value).digest("hex");

function sourceFiles(extra = []) {
  return [{path: "index.html", content: '<!doctype html><html lang="en"><head><title>Studio</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'},
    {path: "src/main.tsx", content: 'import {createRoot} from "react-dom/client"; import App from "./App"; createRoot(document.getElementById("root")!).render(<App/>);'},
    {path: "src/App.tsx", content: 'export default function App(){return <main><h1>Café “Ünïcode” ✓</h1><img src="/images/hero.png" alt=""/></main>}'},
    {path: "package.json", content: packageJson}, {path: "package-lock.json", content: packageLock}, ...extra];
}
function version({number = 1, id = `50000000-0000-4000-8000-00000000000${number}`, files = sourceFiles(), summary = "First full source", assets = true} = {}) {
  return {id, artifactId, number, parentVersionId: null,
    content: {schemaVersion: 1, kind: "website", title: "Studio\nName", sections: [], websiteSource: {schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx", files,
      assets: assets ? [{id: assetId, path: "public/images/hero.png", sha256: sha256(image), bytes: image.length, mediaType: "image/png"}] : [],
      routes: [{path: "/", title: "Home"}]}},
    style: {id: "automatic", name: "Automatic", description: "Original direction", version: 1, typography: {headingFont: "Inter", bodyFont: "Inter"}, colors: {accent: "#333333"}, referenceAssetIds: []},
    assetIds: assets ? [assetId] : [], createdAt: "2026-10-08T00:00:00.000Z", createdBy: "70000000-0000-4000-8000-000000000001", changeSummary: summary};
}
const artwork = [{id: assetId, path: "public/images/hero.png", sha256: sha256(image), mediaType: "image/png", bytes: image}];

/** In-memory GitHub Git Data API. Tree and commit ids are content-derived so
 * identical content yields identical ids, like Git. */
function mockGitHub() {
  const state = {refs: new Map(), commits: new Map(), trees: new Map(), blobs: new Map(), calls: [], fail: null};
  const hash = value => createHash("sha1").update(JSON.stringify(value)).digest("hex");
  const json = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), {status, headers: {"content-type": "application/json", ...headers}});
  state.fetch = async (url, init) => {
    assert(url.startsWith("https://api.github.com/"), url);
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.headers["X-GitHub-Api-Version"], "2026-03-10");
    assert.equal(init.redirect, "error");
    const route = url.slice("https://api.github.com".length), method = init.method, body = init.body ? JSON.parse(init.body) : undefined;
    state.calls.push({method, route, body});
    if (state.fail) { const failure = state.fail(method, route, body); if (failure) return failure; }
    const prefix = `/repos/${repository}/git`;
    assert(route.startsWith(prefix), route);
    const rest = route.slice(prefix.length);
    if (method === "GET" && rest.startsWith("/ref/heads/")) {
      const sha = state.refs.get(rest.slice("/ref/heads/".length));
      return sha ? json(200, {ref: `refs/heads/${rest.slice(11)}`, object: {sha, type: "commit"}}) : json(404, {message: "Not Found"});
    }
    if (method === "GET" && rest.startsWith("/commits/")) {
      const commit = state.commits.get(rest.slice(9));
      return commit ? json(200, commit) : json(404, {message: "Not Found"});
    }
    if (method === "GET" && rest.startsWith("/trees/")) {
      const [sha, query] = rest.slice(7).split("?");
      assert.equal(query, "recursive=1");
      const tree = state.trees.get(sha);
      return tree ? json(200, {sha, truncated: false, tree: tree.map(entry => ({path: entry.path, mode: entry.mode, type: "blob", sha: entry.sha}))}) : json(404, {});
    }
    if (method === "POST" && rest === "/blobs") {
      assert.equal(body.encoding, "base64");
      const bytes = Buffer.from(body.content, "base64");
      const sha = gitBlobSha(bytes); state.blobs.set(sha, bytes);
      return json(201, {sha, url: "mock"});
    }
    if (method === "POST" && rest === "/trees") {
      assert.equal(body.base_tree, undefined, "a full-project push never merges into the previous tree");
      const entries = body.tree.map(entry => {
        assert.equal(entry.mode, "100644"); assert.equal(entry.type, "blob");
        assert.equal((entry.sha === undefined) + (entry.content === undefined), 1, "each entry has exactly one of sha or content");
        if (entry.content !== undefined) { const bytes = Buffer.from(entry.content, "utf8"), sha = gitBlobSha(bytes); state.blobs.set(sha, bytes); return {path: entry.path, mode: entry.mode, sha}; }
        assert(state.blobs.has(entry.sha), `tree references a blob GitHub does not have: ${entry.path}`);
        return {path: entry.path, mode: entry.mode, sha: entry.sha};
      });
      const sha = hash(entries); state.trees.set(sha, entries);
      return json(201, {sha, tree: []});
    }
    if (method === "POST" && rest === "/commits") {
      assert(state.trees.has(body.tree));
      const sha = hash([body.message, body.tree, body.parents, state.commits.size]);
      state.commits.set(sha, {sha, message: body.message, tree: {sha: body.tree}, parents: body.parents.map(parent => ({sha: parent}))});
      return json(201, {sha});
    }
    if (method === "POST" && rest === "/refs") {
      const name = body.ref.replace(/^refs\/heads\//, "");
      if (state.refs.has(name)) return json(422, {message: "Reference already exists"});
      state.refs.set(name, body.sha); return json(201, {ref: body.ref, object: {sha: body.sha}});
    }
    if (method === "PATCH" && rest.startsWith("/refs/heads/")) {
      const name = rest.slice(12), current = state.refs.get(name), next = state.commits.get(body.sha);
      assert.equal(body.force, false, "Makeborne never force-pushes");
      if (!current || !next.parents.some(parent => parent.sha === current)) return json(422, {message: "Update is not a fast forward"});
      state.refs.set(name, body.sha); return json(200, {object: {sha: body.sha}});
    }
    throw new Error(`Unexpected GitHub request ${method} ${route}`);
  };
  state.client = githubClient(token, state.fetch);
  state.sequence = () => state.calls.map(call => `${call.method} ${call.route.replace(`/repos/${repository}`, "").replace(/[0-9a-f]{40}/g, "<sha>")}`);
  state.reset = () => { state.calls.length = 0; };
  /** Simulates someone committing on the branch in GitHub. */
  state.external = (message, files = [{path: "index.html", content: "edited in GitHub"}]) => {
    const entries = files.map(file => { const bytes = Buffer.from(file.content), sha = gitBlobSha(bytes); state.blobs.set(sha, bytes); return {path: file.path, mode: "100644", sha}; });
    const tree = hash(entries); state.trees.set(tree, entries);
    const parent = state.refs.get(branch), sha = hash(["external", message, parent, state.commits.size]);
    state.commits.set(sha, {sha, message, tree: {sha: tree}, parents: parent ? [{sha: parent}] : []});
    state.refs.set(branch, sha); return sha;
  };
  return state;
}

let count = 0;
async function check(name, run) { await run(); count++; console.log(`PASS ${name}`); }
async function rejects(promise, code) {
  await assert.rejects(promise, error => { assert.equal(error.code, code, `${error.code}: ${error.message}`); return true; });
}
const treeOf = (github, commitSha) => github.trees.get(github.commits.get(commitSha).tree.sha);
const fileText = (github, commitSha, filePath) => github.blobs.get(treeOf(github, commitSha).find(entry => entry.path === filePath).sha).toString("utf8");

(async () => {
  const snapshot = githubSourceSnapshot(version(), artwork, artifactId);

  await check("snapshot is the complete project: every source file, verified artwork, README and .gitignore — nothing else", () => {
    assert.deepEqual(snapshot.files.map(file => file.path), [".gitignore", "README.md", "index.html", "package-lock.json", "package.json", "public/images/hero.png", "src/App.tsx", "src/main.tsx"]);
    for (const file of sourceFiles()) assert.equal(Buffer.from(snapshot.files.find(entry => entry.path === file.path).bytes).toString("utf8"), file.content, file.path);
    const asset = snapshot.files.find(file => file.path === "public/images/hero.png");
    assert(asset.binary); assert.equal(Buffer.compare(Buffer.from(asset.bytes), image), 0);
    for (const file of snapshot.files) {
      assert(SourcePathSchema.safeParse(file.path).success, file.path);
      assert(!/(^|\/)\.env(\.|$)|^\.makeborne\/|node_modules|^dist\//i.test(file.path), file.path);
      assert.equal(file.sha, gitBlobSha(file.bytes));
    }
    assert.equal(snapshot.totalBytes, snapshot.files.reduce((total, file) => total + file.bytes.byteLength, 0));
  });

  await check("package.json and package-lock.json are pushed byte-for-byte as stored", () => {
    assert.equal(Buffer.from(snapshot.files.find(file => file.path === "package.json").bytes).toString("utf8"), packageJson);
    assert.equal(Buffer.from(snapshot.files.find(file => file.path === "package-lock.json").bytes).toString("utf8"), packageLock);
  });

  await check("README explains how to run the project, credits Makeborne and promises no secrets", () => {
    const readme = Buffer.from(snapshot.files.find(file => file.path === "README.md").bytes).toString("utf8");
    assert(readme.startsWith("# Studio Name\n"), "title is one line");
    for (const text of ["made with [Makeborne](https://makeborne.com)", "npm install", "npm run build", "npx vite ", "dist/", `makeborne/site-${artifactId}`, "never force-pushes", "no API keys, passwords, environment files or customer data", "saved version 1"]) assert(readme.includes(text), text);
    // The pinned toolchain has no dev script, so the README must not invent one.
    assert(!readme.includes("npm run dev"));
    const withDev = sourceFiles().map(file => file.path === "package.json" ? {...file, content: JSON.stringify({...JSON.parse(packageJson), scripts: {dev: "vite", build: "vite build", preview: "vite preview"}})} : file);
    const devReadme = (() => { try { return githubSourceSnapshot(version({files: withDev}), artwork, artifactId); } catch (error) { return error; } })();
    // Changed package metadata is not an approved toolchain: refused, not rewritten.
    assert.equal(devReadme.code, "SOURCE_UNAVAILABLE");
    assert(!readme.includes(token));
  });

  await check("commit message names the version and change, with Makeborne trailers", () => {
    assert.match(snapshot.message, /^Makeborne: version 1 — First full source\n\n/);
    assert(snapshot.message.includes(`\nMakeborne-Artifact: ${artifactId}\n`));
    assert(snapshot.message.includes("\nMakeborne-Version: 50000000-0000-4000-8000-000000000001\n"));
    assert.match(snapshot.message, /\nMakeborne-Source: [0-9a-f]{64}\n$/);
    const long = githubSourceSnapshot(version({summary: `Line one\nline two\u0000 ${"x".repeat(200)}`}), artwork, artifactId).message.split("\n")[0];
    assert(!long.includes("\u0000")); assert(long.endsWith("…")); assert(long.length <= "Makeborne: version 1 — ".length + 72);
    assert.match(githubSourceSnapshot(version({summary: ""}), artwork, artifactId).message, /^Makeborne: version 1 — website source\n/);
  });

  await check("project README and .gitignore are kept; the generated README moves beside it", () => {
    const own = githubSourceSnapshot(version({files: sourceFiles([{path: "README.md", content: "# Mine\n"}, {path: ".gitignore", content: "custom\n"}])}), artwork, artifactId);
    assert.equal(Buffer.from(own.files.find(file => file.path === "README.md").bytes).toString(), "# Mine\n");
    assert.equal(Buffer.from(own.files.find(file => file.path === ".gitignore").bytes).toString(), "custom\n");
    assert(own.files.some(file => file.path === "MAKEBORNE.md"));
  });

  await check("invalid paths, environment files, changed artwork and other artifacts are refused before GitHub", () => {
    for (const bad of [".env", ".env.local", "src/.ENV.production", "../escape.ts", ".makeborne/manifest.json", "node_modules/x.js", "dist/index.js", "src\\main.ts"]) {
      assert.throws(() => githubSourceSnapshot(version({files: sourceFiles([{path: bad, content: "SECRET=1"}])}), artwork, artifactId), error => error.code === "SOURCE_UNAVAILABLE", bad);
    }
    assert.throws(() => githubSourceSnapshot(version(), [{...artwork[0], bytes: Buffer.from("changed")}], artifactId), error => error.code === "SOURCE_UNAVAILABLE");
    assert.throws(() => githubSourceSnapshot(version(), [], artifactId), error => error.code === "SOURCE_UNAVAILABLE");
    assert.throws(() => githubSourceSnapshot(version(), artwork, "60000000-0000-4000-8000-000000000002"), error => error.code === "SOURCE_UNAVAILABLE");
  });

  await check("size and file-count caps refuse oversized pushes", () => {
    const {totalBytes, entries} = GITHUB_SOURCE_LIMITS;
    try {
      GITHUB_SOURCE_LIMITS.totalBytes = snapshot.totalBytes - 1;
      assert.throws(() => githubSourceSnapshot(version(), artwork, artifactId), error => error.code === "SOURCE_TOO_LARGE" && error.status === 413);
      GITHUB_SOURCE_LIMITS.totalBytes = totalBytes; GITHUB_SOURCE_LIMITS.entries = snapshot.files.length - 1;
      assert.throws(() => githubSourceSnapshot(version(), artwork, artifactId), error => error.code === "SOURCE_TOO_LARGE");
    } finally { GITHUB_SOURCE_LIMITS.totalBytes = totalBytes; GITHUB_SOURCE_LIMITS.entries = entries; }
    assert.equal(totalBytes, 48_000_000); assert.equal(entries, 400);
  });

  const github = mockGitHub();
  let first;
  await check("first push creates the branch: blobs → tree → commit → create ref, in one commit", async () => {
    first = await pushWebsiteSource(github.client, {repository, artifactId, recordedCommitSha: null, snapshot});
    assert.deepEqual(github.sequence(), [`GET /git/ref/heads/${branch}`, "POST /git/blobs", "POST /git/trees", "POST /git/commits", "POST /git/refs"]);
    const [, blob, tree, commit, ref] = github.calls;
    assert.equal(blob.body.encoding, "base64"); assert.equal(blob.body.content, image.toString("base64"));
    assert.equal(tree.body.tree.length, snapshot.files.length);
    assert.deepEqual(tree.body.tree.find(entry => entry.path === "public/images/hero.png"), {path: "public/images/hero.png", mode: "100644", type: "blob", sha: gitBlobSha(image)});
    assert.equal(tree.body.tree.find(entry => entry.path === "package-lock.json").content, packageLock);
    assert.deepEqual(commit.body.parents, []); assert.equal(commit.body.message, snapshot.message);
    assert.deepEqual(ref.body, {ref: `refs/heads/${branch}`, sha: first.commitSha});
    assert.deepEqual({created: first.created, alreadySynced: first.alreadySynced, branch: first.branch}, {created: true, alreadySynced: false, branch});
    assert.equal(github.refs.get(branch), first.commitSha);
    assert.equal(Buffer.compare(github.blobs.get(gitBlobSha(image)), image), 0, "binary bytes survive base64 transport");
    assert.equal(fileText(github, first.commitSha, "src/App.tsx"), sourceFiles()[2].content, "Unicode text survives");
  });

  let second;
  const v2 = githubSourceSnapshot(version({number: 2, summary: "New hero copy", files: sourceFiles().map(file => file.path === "src/App.tsx" ? {...file, content: "export default function App(){return <h1>v2</h1>}"} : file)}), artwork, artifactId);
  await check("next version updates the branch fast-forward and reuses unchanged artwork", async () => {
    github.reset();
    second = await pushWebsiteSource(github.client, {repository, artifactId, recordedCommitSha: first.commitSha, snapshot: v2});
    assert.deepEqual(github.sequence(), [`GET /git/ref/heads/${branch}`, "GET /git/commits/<sha>", "GET /git/trees/<sha>?recursive=1", "POST /git/trees", "POST /git/commits", `PATCH /git/refs/heads/${branch}`]);
    const tree = github.calls[3].body.tree;
    assert(tree.every(entry => entry.content === undefined || entry.path === "src/App.tsx" || entry.path === "README.md"), "unchanged text is referenced by sha");
    assert.deepEqual(github.calls[4].body.parents, [first.commitSha]);
    assert.deepEqual(github.calls[5].body, {sha: second.commitSha, force: false});
    assert.equal(second.created, false);
    assert.match(github.commits.get(second.commitSha).message, /^Makeborne: version 2 — New hero copy/);
  });

  await check("files removed from the project disappear from the branch (full tree, no base_tree)", async () => {
    const lean = githubSourceSnapshot(version({number: 3, assets: false}), [], artifactId);
    const scratch = mockGitHub();
    const a = await pushWebsiteSource(scratch.client, {repository, artifactId, recordedCommitSha: null, snapshot});
    const b = await pushWebsiteSource(scratch.client, {repository, artifactId, recordedCommitSha: a.commitSha, snapshot: lean});
    assert(!treeOf(scratch, b.commitSha).some(entry => entry.path === "public/images/hero.png"));
  });

  await check("pushing the same version again is idempotent: no commit, no ref change", async () => {
    github.reset();
    const again = await pushWebsiteSource(github.client, {repository, artifactId, recordedCommitSha: second.commitSha, snapshot: v2});
    assert.deepEqual(github.sequence(), [`GET /git/ref/heads/${branch}`, "GET /git/commits/<sha>", "GET /git/trees/<sha>?recursive=1", "POST /git/trees"]);
    assert.deepEqual(again, {commitSha: second.commitSha, branch, alreadySynced: true, created: false});
  });

  await check("a lost status update is recovered: Makeborne commit on top of the recorded one is accepted", async () => {
    // second was pushed, but suppose the database still records first.
    github.reset();
    const v3 = githubSourceSnapshot(version({number: 3, summary: "Third"}), artwork, artifactId);
    const third = await pushWebsiteSource(github.client, {repository, artifactId, recordedCommitSha: first.commitSha, snapshot: v3});
    assert.equal(third.alreadySynced, false);
    assert.deepEqual(github.commits.get(third.commitSha).parents, [{sha: second.commitSha}]);
    second = third;
  });

  await check("BRANCH_CHANGED: external commits are never overwritten and nothing is written", async () => {
    const external = github.external("Edit in GitHub");
    github.reset();
    await rejects(pushWebsiteSource(github.client, {repository, artifactId, recordedCommitSha: second.commitSha, snapshot: v2}), "BRANCH_CHANGED");
    assert.deepEqual(github.sequence(), [`GET /git/ref/heads/${branch}`, "GET /git/commits/<sha>"]);
    assert.equal(github.refs.get(branch), external);
    await assert.rejects(pushWebsiteSource(github.client, {repository, artifactId, recordedCommitSha: second.commitSha, snapshot: v2}), error => error.status === 409 && error.message.includes(branch) && /delete .* in GitHub|reset it/.test(error.message));
  });

  await check("BRANCH_CHANGED: a Makeborne-looking commit that is not on top of the recorded push is refused", async () => {
    const scratch = mockGitHub();
    const a = await pushWebsiteSource(scratch.client, {repository, artifactId, recordedCommitSha: null, snapshot});
    scratch.external("Edit");
    scratch.external(`Makeborne: version 9 — forged\n\nMakeborne-Artifact: ${artifactId}\n`);
    await rejects(pushWebsiteSource(scratch.client, {repository, artifactId, recordedCommitSha: a.commitSha, snapshot: v2}), "BRANCH_CHANGED");
    // Same message but different content: refused after comparing trees, before any commit.
    const forged = mockGitHub();
    forged.external(v2.message);
    forged.reset();
    await rejects(pushWebsiteSource(forged.client, {repository, artifactId, recordedCommitSha: null, snapshot: v2}), "BRANCH_CHANGED");
    assert(!forged.sequence().some(call => call.startsWith("POST /git/commits") || call.includes("/refs")));
  });

  await check("a pre-existing branch without a recorded push is refused", async () => {
    const scratch = mockGitHub();
    scratch.external("Someone's branch");
    await rejects(pushWebsiteSource(scratch.client, {repository, artifactId, recordedCommitSha: null, snapshot}), "BRANCH_CHANGED");
    // First push landed but its status was lost: retrying the same version adopts it.
    const lost = mockGitHub();
    const a = await pushWebsiteSource(lost.client, {repository, artifactId, recordedCommitSha: null, snapshot});
    lost.reset();
    assert.deepEqual(await pushWebsiteSource(lost.client, {repository, artifactId, recordedCommitSha: null, snapshot}), {commitSha: a.commitSha, branch, alreadySynced: true, created: false});
    assert(!lost.sequence().some(call => call.startsWith("POST /git/commits") || call.includes("/refs")));
    await rejects(pushWebsiteSource(lost.client, {repository, artifactId, recordedCommitSha: null, snapshot: v2}), "BRANCH_CHANGED");
  });

  await check("a deleted Makeborne branch is recreated with the full project (nothing to overwrite)", async () => {
    const scratch = mockGitHub();
    const a = await pushWebsiteSource(scratch.client, {repository, artifactId, recordedCommitSha: null, snapshot});
    scratch.refs.delete(branch); scratch.reset();
    const b = await pushWebsiteSource(scratch.client, {repository, artifactId, recordedCommitSha: a.commitSha, snapshot: v2});
    assert.equal(b.created, true);
    assert.deepEqual(scratch.sequence(), [`GET /git/ref/heads/${branch}`, "POST /git/blobs", "POST /git/trees", "POST /git/commits", "POST /git/refs"]);
  });

  await check("a legacy snapshot branch upgrades to the full project when its head is the recorded commit", async () => {
    const scratch = mockGitHub();
    const legacyPush = await pushWebsiteSnapshot(scratch.client, {repository, artifactId, version: 1, html: "<!doctype html><p>Static</p>", recordedCommitSha: null});
    const upgraded = await pushWebsiteSource(scratch.client, {repository, artifactId, recordedCommitSha: legacyPush.commitSha, snapshot: v2});
    assert.deepEqual(scratch.commits.get(upgraded.commitSha).parents, [{sha: legacyPush.commitSha}]);
    assert.notEqual(fileText(scratch, upgraded.commitSha, "index.html"), "<!doctype html><p>Static</p>");
  });

  await check("empty repositories, expired tokens, rate limits and integrity failures surface clear errors", async () => {
    const empty = mockGitHub();
    empty.fail = (method, route) => method === "POST" && route.endsWith("/git/blobs") ? new Response(JSON.stringify({message: "Git Repository is empty."}), {status: 409}) : null;
    await rejects(pushWebsiteSource(empty.client, {repository, artifactId, recordedCommitSha: null, snapshot}), "REPOSITORY_EMPTY");
    const expired = mockGitHub();
    expired.fail = () => new Response(JSON.stringify({message: "Bad credentials"}), {status: 401});
    await assert.rejects(pushWebsiteSource(expired.client, {repository, artifactId, recordedCommitSha: null, snapshot}), error => error.code === "GITHUB_RECONNECT" && error.status === 401 && /Reconnect GitHub/.test(error.message));
    const limited = mockGitHub();
    limited.fail = (method) => method === "POST" ? new Response("{}", {status: 403, headers: {"x-ratelimit-remaining": "0"}}) : null;
    await assert.rejects(pushWebsiteSource(limited.client, {repository, artifactId, recordedCommitSha: null, snapshot}), error => error.code === "GITHUB_RATE_LIMITED" && error.status === 429);
    const denied = mockGitHub();
    denied.fail = (method) => method === "POST" ? new Response("{}", {status: 403}) : null;
    await assert.rejects(pushWebsiteSource(denied.client, {repository, artifactId, recordedCommitSha: null, snapshot}), error => error.code === "GITHUB_REQUEST_FAILED" && /permissions/.test(error.message));
    const corrupt = mockGitHub();
    corrupt.fail = (method, route) => method === "POST" && route.endsWith("/git/blobs") ? new Response(JSON.stringify({sha: "0".repeat(40)}), {status: 201}) : null;
    await rejects(pushWebsiteSource(corrupt.client, {repository, artifactId, recordedCommitSha: null, snapshot}), "GITHUB_INTEGRITY");
    assert.deepEqual(corrupt.sequence(), [`GET /git/ref/heads/${branch}`, "POST /git/blobs"]);
    const raced = mockGitHub();
    const a = await pushWebsiteSource(raced.client, {repository, artifactId, recordedCommitSha: null, snapshot});
    raced.fail = (method) => method === "PATCH" ? (raced.external("Concurrent"), null) : null;
    await rejects(pushWebsiteSource(raced.client, {repository, artifactId, recordedCommitSha: a.commitSha, snapshot: v2}), "GITHUB_REQUEST_FAILED");
  });

  await check("unsafe repository names are refused before any request", async () => {
    const scratch = mockGitHub();
    for (const name of ["../x", "octo/site/extra", "octo", "octo/si te"]) await rejects(pushWebsiteSource(scratch.client, {repository: name, artifactId, recordedCommitSha: null, snapshot}), "REPOSITORY_ACCESS");
    assert.equal(scratch.calls.length, 0);
  });

  await check("legacy static websites keep the published snapshot sync unchanged", async () => {
    const html = "<!doctype html><html><body><h1>Static</h1></body></html>";
    const scratch = mockGitHub();
    const created = await pushWebsiteSnapshot(scratch.client, {repository, artifactId, version: 4, html, recordedCommitSha: null});
    assert.deepEqual(scratch.sequence(), [`GET /git/ref/heads/${branch}`, "POST /git/trees", "POST /git/commits", "POST /git/refs"]);
    assert.deepEqual(scratch.calls[1].body.tree, [{path: "index.html", mode: "100644", type: "blob", content: html}, {path: "README.md", mode: "100644", type: "blob", content: "# Website exported from Makeborne\n\nPublished version 4. Open index.html or deploy this branch as a static site.\n\nThis branch is managed by Makeborne. Copy it to another branch before editing externally. This export is one-way and manual: Makeborne only writes here when someone pushes a version, and external edits are not imported. No backend, credentials, or private project sources are included.\n"}]);
    assert.equal(scratch.calls[2].body.message, `Makeborne website ${artifactId} version 4\n\nSnapshot: ${createHash("sha256").update(html).digest("hex")}`);
    assert.deepEqual(scratch.calls[2].body.parents, []);
    scratch.reset();
    assert.deepEqual(await pushWebsiteSnapshot(scratch.client, {repository, artifactId, version: 4, html, recordedCommitSha: null}), {commitSha: created.commitSha, branch, alreadySynced: true});
    assert.deepEqual(scratch.sequence(), [`GET /git/ref/heads/${branch}`, "GET /git/commits/<sha>"]);
    scratch.reset();
    const next = await pushWebsiteSnapshot(scratch.client, {repository, artifactId, version: 5, html: `${html}\n`, recordedCommitSha: created.commitSha});
    assert.deepEqual(scratch.sequence(), [`GET /git/ref/heads/${branch}`, "GET /git/commits/<sha>", "POST /git/trees", "POST /git/commits", `PATCH /git/refs/heads/${branch}`]);
    scratch.external("Edit");
    await assert.rejects(pushWebsiteSnapshot(scratch.client, {repository, artifactId, version: 6, html, recordedCommitSha: next.commitSha}), error => error.code === "BRANCH_CHANGED" && error.message === "This GitHub branch has external changes. Your code was not overwritten. Review the branch in GitHub before pushing again.");
    const missing = mockGitHub();
    await rejects(pushWebsiteSnapshot(missing.client, {repository, artifactId, version: 6, html, recordedCommitSha: next.commitSha}), "BRANCH_MISSING");
  });

  await check("link URLs point at the commit and branch, and only for safe names", () => {
    const sha = "a".repeat(40);
    assert.deepEqual(githubLinkUrls({repository_name: repository, branch, commit_sha: sha}), {branchUrl: `https://github.com/${repository}/tree/${branch}`, commitUrl: `https://github.com/${repository}/commit/${sha}`});
    assert.deepEqual(githubLinkUrls({repository_name: repository, branch, commit_sha: null}), {branchUrl: `https://github.com/${repository}/tree/${branch}`, commitUrl: null});
    assert.deepEqual(githubLinkUrls({repository_name: "evil.com/../x/y", branch, commit_sha: sha}), {branchUrl: null, commitUrl: null});
    assert.deepEqual(githubLinkUrls(null), {branchUrl: null, commitUrl: null});
    assert.equal(websiteBranch(artifactId), branch);
  });

  await check("legacy-toolchain sources get the same approved portable adaptation as the source download", () => {
    const old = sourceFiles().map(file => file.path === "package.json" ? {...file, content: JSON.stringify(legacy.package)} : file.path === "package-lock.json" ? {...file, content: JSON.stringify(legacy.lock)} : file);
    const adapted = githubSourceSnapshot(version({files: old}), artwork, artifactId);
    assert.equal(Buffer.from(adapted.files.find(file => file.path === "package.json").bytes).toString(), JSON.stringify(JSON.parse(packageJson), null, 2));
  });

  await check("the route prepares and validates the snapshot before contacting GitHub", () => {
    const route = fs.readFileSync(path.join(root, "src/app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/github/route.ts"), "utf8");
    assert(route.indexOf("githubSourceSnapshot(version") > 0 && route.indexOf("githubSourceSnapshot(version") < route.indexOf("githubConnection(user.id)"));
    assert(route.indexOf("resolveWebsiteSourceAssets(client") < route.indexOf("githubConnection(user.id)"), "artwork is read with the RLS-bound client before GitHub");
    assert(route.includes('workspace?.role!=="owner"'));
    assert(/PUBLISH_FIRST/.test(route), "legacy sites still require a published version");
  });

  console.log(`${count} GitHub website sync check groups passed against a mocked GitHub API. No network, database or storage access.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
