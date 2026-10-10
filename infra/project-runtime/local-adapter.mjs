/** Operator-only local qualification adapter. Never import into app routes. */
import {spawn} from "node:child_process";
import {mkdtemp, writeFile, rm, mkdir, lstat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve, dirname, basename} from "node:path";
import {randomUUID, createHash} from "node:crypto";
import {readBoundedLocalFile} from "./local-output-store.mjs";
import {canonicalRuntimeJson as canonical} from "./identity.mjs";

export async function removeLocalTemporary(directory, prefix = "makeborne-build-") {
  const target = resolve(directory);
  if (!["makeborne-build-", "makeborne-probe-"].includes(prefix) || dirname(target) !== resolve(tmpdir())
    || !basename(target).startsWith(prefix)) throw new Error("RUNTIME_CLEANUP_PATH_INVALID");
  const stat = await lstat(target).catch(error => {if (error.code === "ENOENT") return null; throw error;});
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("RUNTIME_CLEANUP_PATH_INVALID");
  await rm(target, {recursive: true, force: true});
}

export function dockerCommand(args, timeout = 15000, outputLimit = 1_000_000, abortSignal) {
  abortSignal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout});
    const aborted = () => child.kill();
    abortSignal?.addEventListener("abort", aborted, {once: true});
    if (abortSignal?.aborted) aborted();
    let output = "", bytes = 0, exceeded = false;
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => {
      bytes += data.length;
      if (bytes > outputLimit) {exceeded = true; child.kill(); return;}
      output += data.toString("utf8");
    });
    child.once("error", error => {abortSignal?.removeEventListener("abort", aborted); reject(error);});
    child.once("close", (code, signal) => {
      abortSignal?.removeEventListener("abort", aborted);
      if (abortSignal?.aborted) reject(new Error("RUNTIME_CANCELLED"));
      else if (exceeded || signal) reject(new Error(exceeded ? "RUNTIME_LOG_LIMIT" : "RUNTIME_DEADLINE"));
      else resolve({code, output});
    });
  });
}

export function localRuntimeFlags(name, inputDirectory) {
  return ["--name", name, "--label", "makeborne.runtime=local-qualification", "--read-only", "--network", "none",
    "--cpus", "1", "--memory", "512m", "--memory-swap", "512m", "--pids-limit", "64", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true", "--user", "1000:1000", "--workdir", "/tmp",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=192m,uid=1000,gid=1000",
    "--mount", `type=bind,source=${inputDirectory},target=/input,readonly`, "--env", "NODE_ENV=production", "--env", "HOME=/tmp"];
}

/** Input must come from websiteBuildInput after existing saved-revision authority.
 * No arbitrary image, shell, mount, environment or command is accepted. */
export async function runLocalBuild(request, {timeoutMs = 60000, signal} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error("RUNTIME_DEADLINE_INVALID");
  const command = (args, timeout = 15000, limit = 1_000_000) => dockerCommand(args, timeout, limit, signal);
  const image = await command(["image", "inspect", "makeborne-react-vite:local-v1", "--format", "{{.Id}}"]);
  const imageId = image.output.trim();
  if (image.code !== 0 || !/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("RUNTIME_IMAGE_MISSING");
  const directory = await mkdtemp(join(tmpdir(), "makeborne-build-"));
  const input = join(directory, "input"), output = join(directory, "output"), name = `makeborne-build-${randomUUID()}`;
  const started = Date.now(); let copied = false;
  try {
    await mkdir(input); await mkdir(output);
    const bytes = Buffer.from(JSON.stringify(request));
    if (bytes.length > 65_000_000) throw new Error("INPUT_LIMIT");
    await writeFile(join(input, "request.json"), bytes, {flag: "wx"});
    const created = await command(["create", ...localRuntimeFlags(name, input), "--env", `MAKEBORNE_RUNTIME_IMAGE=${imageId}`,
      "--env", `MAKEBORNE_RUNTIME_TTL_MS=${Math.min(timeoutMs + 5000, 65000)}`, imageId]);
    if (created.code !== 0) throw new Error("RUNTIME_CREATE_FAILED");
    const deadline = Date.now() + timeoutMs;
    const start = await command(["start", name]);
    if (start.code !== 0) throw new Error("RUNTIME_START_FAILED");
    while (true) {
      signal?.throwIfAborted();
      if (Date.now() >= deadline) throw new Error("RUNTIME_DEADLINE");
      const state = await command(["inspect", name, "--format", "{{json .State}}"]);
      const actual = JSON.parse(state.output);
      if (!actual.Running) {
        const logs = await command(["logs", name]);
        return {status: "failed", imageId, elapsedMs: Date.now() - started, logs: logs.output, oomKilled: actual.OOMKilled};
      }
      const ready = await command(["exec", name, "test", "-f", "/tmp/build-complete"]);
      if (ready.code === 0) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    // Docker's archive API cannot copy tmpfs. Read only manifest-listed bytes
    // through a fixed, trusted command; never extract an arbitrary tar on host.
    const transfer = `const fs=require('fs');const manifest=JSON.parse(fs.readFileSync('/tmp/result/makeborne-build.json','utf8'));const files=manifest.files.map(f=>{if(!/^[A-Za-z0-9_.-]+(?:\\/[A-Za-z0-9_.-]+)*$/.test(f.path)||f.path.split('/').includes('..'))throw Error('PATH_INVALID');const p='/tmp/result/'+f.path;if(!fs.lstatSync(p).isFile())throw Error('FILE_INVALID');return {...f,base64:fs.readFileSync(p).toString('base64')}});process.stdout.write(JSON.stringify({manifest,files}))`;
    const copiedFiles = await command(["exec", name, "node", "-e", transfer], 15000, 70_000_000);
    if (copiedFiles.code !== 0) throw new Error("RUNTIME_OUTPUT_MISSING");
    const transferred = JSON.parse(copiedFiles.output);
    const {buildHash, ...identity} = transferred.manifest;
    const hash = bytes => createHash("sha256").update(bytes).digest("hex");
    if (identity.revisionId !== request.revisionId || identity.artifactId !== request.artifactId || identity.version !== request.version
      || identity.sourceHash !== request.sourceHash || identity.toolchainHash !== request.toolchainHash || identity.runtimeImageId !== imageId
      || canonical(identity.routes) !== canonical(request.routes)
      || buildHash !== hash(canonical(identity)) || !Array.isArray(transferred.files) || transferred.files.length > 1000
      || canonical(transferred.files.map(file => ({path: file.path, bytes: file.bytes, sha256: file.sha256}))) !== canonical(identity.files)) throw new Error("BUILD_IDENTITY_MISMATCH");
    const paths = new Set(); let total = 0;
    for (const file of transferred.files) {
      signal?.throwIfAborted();
      if (typeof file.path !== "string" || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(file.path)
        || file.path.split("/").some(part => part === "." || part === ".." || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
        || file.path === "makeborne-build.json" || paths.has(file.path.toLowerCase())) throw new Error("BUILD_PATH_INVALID");
      paths.add(file.path.toLowerCase());
      const bytes = Buffer.from(file.base64, "base64"); total += bytes.length;
      if (total > 50_000_000 || bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error("BUILD_BYTES_MISMATCH");
      const destination = join(output, ...file.path.split("/"));
      await mkdir(join(destination, ".."), {recursive: true}); await writeFile(destination, bytes, {flag: "wx"});
    }
    if (!paths.has("index.html")) throw new Error("BUILD_ENTRY_MISSING");
    await writeFile(join(output, "makeborne-build.json"), JSON.stringify(transferred.manifest), {flag: "wx"});
    const logs = await command(["logs", name]);
    copied = true;
    return {status: "built", imageId, elapsedMs: Date.now() - started, logs: logs.output, outputDirectory: output,
      readFile: async (path, maxBytes, readSignal) => {
        const file = transferred.manifest.files.find(file => file.path === path);
        if (!file || maxBytes !== file.bytes) throw new Error("BUILD_FILE_NOT_LISTED");
        const bytes = await readBoundedLocalFile(join(output, ...file.path.split("/")), maxBytes, readSignal);
        if (!bytes || hash(bytes) !== file.sha256) throw new Error("BUILD_BYTES_MISMATCH");
        return bytes;
      },
      // Caller owns only this fresh temporary directory, never a project path.
      dispose: () => removeLocalTemporary(directory)};
  } finally {
    const removed = await dockerCommand(["rm", "--force", name]);
    if (removed.code !== 0 && !removed.output.includes("No such container")) {
      await removeLocalTemporary(directory);
      throw new Error("RUNTIME_CLEANUP_UNCONFIRMED");
    }
    if (!copied) await removeLocalTemporary(directory);
  }
}
