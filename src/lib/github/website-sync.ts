import "server-only";
import {createHash} from "node:crypto";
import {websiteProjectExportFiles} from "../projects/source-bundle";
import type {resolveWebsiteSourceAssets} from "../projects/source-assets";
import {SourcePathSchema} from "../projects/website-source";
import {RequestError} from "../server/http";
import {GitHubRequestError, type GitHubRequest} from "./api";

/** Upper bounds for one GitHub push. Saved sources are already bounded by
 * WEBSITE_SOURCE_LIMITS (200 files / 2 MB text, 100 images / 40 MB); this adds
 * room only for derived font files, licenses, README.md and .gitignore. */
export const GITHUB_SOURCE_LIMITS = {entries: 400, totalBytes: 48_000_000, uploadConcurrency: 4} as const;

const repositoryPattern = /^(?!\.{1,2}\/)[A-Za-z0-9_.-]+\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;
const branchPattern = /^makeborne\/site-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const shaPattern = /^[0-9a-f]{40}$/;

export function websiteBranch(artifactId: string) {return `makeborne/site-${artifactId}`;}
export function githubLinkUrls(link: {repository_name: string; branch: string; commit_sha: string | null} | null) {
  if (!link || !repositoryPattern.test(link.repository_name) || !branchPattern.test(link.branch)) return {branchUrl: null, commitUrl: null};
  return {branchUrl: `https://github.com/${link.repository_name}/tree/${link.branch}`,
    commitUrl: link.commit_sha && shaPattern.test(link.commit_sha) ? `https://github.com/${link.repository_name}/commit/${link.commit_sha}` : null};
}

/** Git's object id for a blob, so unchanged files are reused and uploads verified. */
export function gitBlobSha(bytes: Uint8Array) {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

function branchChanged(branch: string) {
  return new RequestError("BRANCH_CHANGED", `The GitHub branch ${branch} has commits that weren't made by Makeborne, so nothing was overwritten. Move those changes to another branch, then delete ${branch} in GitHub (or reset it to the last Makeborne commit) and push again.`, 409);
}
function trailer(message: string, key: string) {
  const match = new RegExp(`^${key}: (.+)$`, "m").exec(message);
  return match ? match[1].trim() : null;
}
function oneLine(value: string, max: number) {
  const text = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

type SourceVersion = Parameters<typeof websiteProjectExportFiles>[0];
type Artwork = Awaited<ReturnType<typeof resolveWebsiteSourceAssets>>;
export type GitHubSourceFile = {path: string; bytes: Uint8Array; binary: boolean; sha: string};
export type GitHubSourceSnapshot = {files: GitHubSourceFile[]; message: string; versionId: string; versionNumber: number; sourceHash: string; totalBytes: number};

function readme(input: {title: string; version: number; artifactId: string; scripts: Record<string, unknown>}) {
  const has = (name: string) => typeof input.scripts[name] === "string";
  const dev = has("dev") ? "npm run dev" : "npx vite";
  const preview = has("preview") ? "npm run preview" : "npx vite preview";
  return `# ${oneLine(input.title, 120) || "Website"}

This website was made with [Makeborne](https://makeborne.com). It is a React + Vite project: the complete source of saved version ${input.version}.

## Run it locally

You need a current Node.js LTS release (20.19 or newer).

\`\`\`sh
npm install        # installs the exact versions pinned in package-lock.json
${dev.padEnd(18)} # starts a local development server
npm run build      # writes the production site to dist/
${preview.padEnd(18)} # serves the built site from dist/
\`\`\`

\`dist/\` is a static site: upload it to any static host.

## About this branch

Makeborne pushes each version to \`${websiteBranch(input.artifactId)}\` as one commit and never force-pushes, so earlier versions stay in the history. If commits made outside Makeborne appear on this branch, Makeborne stops and overwrites nothing. To change the code yourself, work on another branch. Changes made in GitHub are not imported back into Makeborne.

## What's included

Every source file and original image of this version. There are no API keys, passwords, environment files or customer data in this repository.
`;
}

/** Materialise the complete project for one saved revision, exactly as the
 * source archive does, then add README.md/.gitignore. Nothing is sent here. */
export function githubSourceSnapshot(input: SourceVersion, artwork: Artwork, artifactId: string): GitHubSourceSnapshot {
  let exported: ReturnType<typeof websiteProjectExportFiles>;
  try {exported = websiteProjectExportFiles(input, artwork);}
  catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError("SOURCE_UNAVAILABLE", `This saved version can't be sent to GitHub. ${error instanceof Error && error.message.length < 300 ? error.message : "Its source could not be verified."}`, 409);
  }
  const {version, source, sourceHash, entries} = exported;
  if (version.artifactId !== artifactId) throw new RequestError("SOURCE_UNAVAILABLE", "The saved website version could not be verified.", 503);
  const assetPaths = new Set(source.assets.map(asset => asset.path));
  const files = entries.map(entry => ({path: entry.path, bytes: Uint8Array.from(entry.bytes), binary: assetPaths.has(entry.path)}));
  const taken = new Set(files.map(file => file.path.toLowerCase()));
  const packageFile = source.files.find(file => file.path === "package.json");
  let scripts: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(packageFile?.content ?? "{}") as {scripts?: unknown};
    if (parsed.scripts && typeof parsed.scripts === "object" && !Array.isArray(parsed.scripts)) scripts = parsed.scripts as Record<string, unknown>;
  } catch {/* The schema already requires a JSON object. */}
  // The project's own README wins; ours then goes beside it.
  const readmePath = taken.has("readme.md") ? "MAKEBORNE.md" : "README.md";
  if (!taken.has(readmePath.toLowerCase())) files.push({path: readmePath, bytes: Buffer.from(readme({title: version.content.title, version: version.number, artifactId, scripts})), binary: false});
  if (!taken.has(".gitignore")) files.push({path: ".gitignore", bytes: Buffer.from("node_modules/\ndist/\n.env\n.env.*\n*.local\n"), binary: false});

  if (files.length > GITHUB_SOURCE_LIMITS.entries) throw new RequestError("SOURCE_TOO_LARGE", `This project has too many files to send to GitHub (limit ${GITHUB_SOURCE_LIMITS.entries}). Download the source instead.`, 413);
  const totalBytes = files.reduce((total, file) => total + file.bytes.byteLength, 0);
  if (totalBytes > GITHUB_SOURCE_LIMITS.totalBytes) throw new RequestError("SOURCE_TOO_LARGE", `This project is larger than ${GITHUB_SOURCE_LIMITS.totalBytes / 1_000_000} MB, the most Makeborne sends to GitHub at once. Download the source instead.`, 413);
  const lower = new Set<string>();
  for (const file of files) {
    const key = file.path.toLowerCase();
    if (!SourcePathSchema.safeParse(file.path).success || lower.has(key)) throw new RequestError("SOURCE_UNAVAILABLE", "This project contains a file path the GitHub export can't use. Download the source instead.", 409);
    lower.add(key);
  }
  for (const key of lower) if (key.split("/").some((_, index, parts) => index > 0 && lower.has(parts.slice(0, index).join("/")))) {
    throw new RequestError("SOURCE_UNAVAILABLE", "This project contains a file path the GitHub export can't use. Download the source instead.", 409);
  }
  const summary = oneLine(version.changeSummary, 72) || "website source";
  const message = `Makeborne: version ${version.number} — ${summary}\n\nComplete source of saved version ${version.number}, pushed from Makeborne.\n\nMakeborne-Artifact: ${artifactId}\nMakeborne-Version: ${version.id}\nMakeborne-Source: ${sourceHash}\n`;
  return {files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(file => ({...file, sha: gitBlobSha(file.bytes)})),
    message, versionId: version.id, versionNumber: version.number, sourceHash, totalBytes};
}

type Ref = {object: {sha: string}};
type Commit = {sha: string; message: string; tree: {sha: string}; parents: {sha: string}[]};
type TreeEntry = {path: string; mode: "100644"; type: "blob"; sha?: string; content?: string};

async function pool<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0, failed = false;
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, async () => {
    while (!failed && next < items.length) {
      try {await run(items[next++]);} catch (error) {failed = true; throw error;}
    }
  }));
}

/** One atomic commit of the complete project on the Makeborne branch:
 * blobs (binary artwork) → tree (full replacement, no base tree) → commit → ref.
 * Never forces. Refuses when the branch head is not Makeborne's last push. */
export async function pushWebsiteSource(github: GitHubRequest, input: {repository: string; artifactId: string; recordedCommitSha: string | null; snapshot: GitHubSourceSnapshot}) {
  const {repository, artifactId, recordedCommitSha, snapshot} = input;
  const branch = websiteBranch(artifactId);
  if (!repositoryPattern.test(repository) || !branchPattern.test(branch)) throw new RequestError("REPOSITORY_ACCESS", "Choose a writable repository enabled in your GitHub connection.", 403);
  const prefix = `/repos/${repository}`;
  const head = await github<Ref>(`${prefix}/git/ref/heads/${branch}`, "GET", undefined, true);
  let headCommit: Commit | null = null;
  if (head) {
    headCommit = await github<Commit>(`${prefix}/git/commits/${head.object.sha}`);
    if (!headCommit) throw branchChanged(branch);
  }
  // The head is ours when it is the commit we recorded, or a Makeborne commit for
  // this website made directly on top of it (a push whose status update was lost).
  const parents = headCommit?.parents.map(parent => parent.sha) ?? [];
  // Without a recorded push, only an identical commit of this exact version
  // (same message and same tree, checked below) is accepted.
  const ours = !!headCommit && !!recordedCommitSha && (head!.object.sha === recordedCommitSha
    || (trailer(headCommit.message, "Makeborne-Artifact") === artifactId && parents.length === 1 && parents[0] === recordedCommitSha));
  const sameVersion = headCommit?.message === snapshot.message;
  if (headCommit && !ours && !sameVersion) throw branchChanged(branch);

  // Reuse blobs that already exist in the branch; upload the remaining artwork.
  const existing = new Set<string>();
  if (headCommit) {
    const tree = await github<{tree: {type: string; sha: string}[]}>(`${prefix}/git/trees/${headCommit.tree.sha}?recursive=1`);
    for (const item of tree?.tree ?? []) if (item.type === "blob") existing.add(item.sha);
  }
  const uploads = snapshot.files.filter(file => file.binary && !existing.has(file.sha));
  try {
    await pool(uploads, GITHUB_SOURCE_LIMITS.uploadConcurrency, async file => {
      const blob = await github<{sha: string}>(`${prefix}/git/blobs`, "POST", {content: Buffer.from(file.bytes).toString("base64"), encoding: "base64"});
      if (blob?.sha !== file.sha) throw new RequestError("GITHUB_INTEGRITY", "GitHub stored an image differently than expected. Nothing was pushed. Try again.", 502);
    });
    const entries: TreeEntry[] = snapshot.files.map(file => existing.has(file.sha) || file.binary
      ? {path: file.path, mode: "100644", type: "blob", sha: file.sha}
      : {path: file.path, mode: "100644", type: "blob", content: Buffer.from(file.bytes).toString("utf8")});
    const tree = await github<{sha: string}>(`${prefix}/git/trees`, "POST", {tree: entries});
    if (!tree?.sha) throw new RequestError("GITHUB_REQUEST_FAILED", "GitHub could not finish this request. Your saved website is unchanged.", 502);
    if (headCommit && sameVersion) {
      if (headCommit.tree.sha === tree.sha) return {commitSha: head!.object.sha, branch, alreadySynced: true, created: false};
      if (!ours) throw branchChanged(branch);
    }
    const commit = await github<{sha: string}>(`${prefix}/git/commits`, "POST", {message: snapshot.message, tree: tree.sha, parents: head ? [head.object.sha] : []});
    if (!commit?.sha) throw new RequestError("GITHUB_REQUEST_FAILED", "GitHub could not finish this request. Your saved website is unchanged.", 502);
    if (head) await github(`${prefix}/git/refs/heads/${branch}`, "PATCH", {sha: commit.sha, force: false});
    else await github(`${prefix}/git/refs`, "POST", {ref: `refs/heads/${branch}`, sha: commit.sha});
    return {commitSha: commit.sha, branch, alreadySynced: false, created: !head};
  } catch (error) {
    // GitHub's Git Data API cannot write to a repository without any commits.
    if (!head && error instanceof GitHubRequestError && error.githubStatus === 409) {
      throw new RequestError("REPOSITORY_EMPTY", "This repository is empty. Add a first commit in GitHub (for example a README), then push again. Makeborne never writes to your default branch.", 409);
    }
    throw error;
  }
}

/** Legacy static websites: the published index.html snapshot and a README,
 * unchanged from the original one-way sync. */
export async function pushWebsiteSnapshot(github: GitHubRequest, input: {repository: string; artifactId: string; version: number; html: string; recordedCommitSha: string | null}) {
  const {repository, artifactId, version, html, recordedCommitSha} = input;
  const branch = websiteBranch(artifactId), prefix = `/repos/${repository}`;
  const head = await github<{object: {sha: string}}>(`${prefix}/git/ref/heads/${branch}`, "GET", undefined, true);
  const digest = createHash("sha256").update(html).digest("hex");
  const marker = `Makeborne website ${artifactId} version ${version}\n\nSnapshot: ${digest}`;
  let commitSha = head?.object.sha ?? null, alreadySynced = false;
  if (head) {
    const commit = await github<{message: string}>(`${prefix}/git/commits/${head.object.sha}`);
    alreadySynced = commit?.message === marker;
    if (!alreadySynced && head.object.sha !== recordedCommitSha) throw new RequestError("BRANCH_CHANGED", "This GitHub branch has external changes. Your code was not overwritten. Review the branch in GitHub before pushing again.", 409);
  } else if (recordedCommitSha) throw new RequestError("BRANCH_MISSING", "The linked branch was removed. Restore it in GitHub before pushing again.", 409);
  if (!alreadySynced) {
    const tree = await github<{sha: string}>(`${prefix}/git/trees`, "POST", {tree: [{path: "index.html", mode: "100644", type: "blob", content: html}, {path: "README.md", mode: "100644", type: "blob", content: `# Website exported from Makeborne\n\nPublished version ${version}. Open index.html or deploy this branch as a static site.\n\nThis branch is managed by Makeborne. Copy it to another branch before editing externally. This export is one-way and manual: Makeborne only writes here when someone pushes a version, and external edits are not imported. No backend, credentials, or private project sources are included.\n`}]});
    const commit = await github<{sha: string}>(`${prefix}/git/commits`, "POST", {message: marker, tree: tree!.sha, parents: head ? [head.object.sha] : []});
    commitSha = commit!.sha;
    if (head) await github(`${prefix}/git/refs/heads/${branch}`, "PATCH", {sha: commitSha, force: false});
    else await github(`${prefix}/git/refs`, "POST", {ref: `refs/heads/${branch}`, sha: commitSha});
  }
  return {commitSha: commitSha!, branch, alreadySynced};
}
