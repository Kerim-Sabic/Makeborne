/** Operator-only disk store for local retention qualification. This is not a
 * production object store or HTTP server. Root must be an owned private temp
 * directory, outside the app/public tree, on a filesystem supporting hard links. */
import {open, lstat, realpath, link, unlink} from "node:fs/promises";
import {constants} from "node:fs";
import {resolve, join} from "node:path";
import {createHash, randomUUID} from "node:crypto";

const fail = code => {throw new Error(code);};
export async function createLocalOutputStore(directory) {
  const root = resolve(directory);
  async function checkRoot() {
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(root) !== root) fail("OUTPUT_ROOT_INVALID");
  }
  await checkRoot();
  const filename = key => {
    if (typeof key !== "string" || key.length > 600 || !key.startsWith("compiled-v1/")
      || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(key)
      || key.split("/").some(part => part === "." || part === "..")) fail("OUTPUT_KEY_INVALID");
    return join(root, createHash("sha256").update(key).digest("hex"));
  };
  return Object.freeze({
    async putIfAbsent(key, bytes, signal) {
      signal.throwIfAborted(); await checkRoot();
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > 50_000_000) fail("OUTPUT_WRITE_LIMIT");
      const destination = filename(key), temporary = join(root, `pending-${randomUUID()}`);
      let handle;
      try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
        signal.throwIfAborted(); await checkRoot();
        try {await link(temporary, destination);} catch (error) {if (error.code !== "EEXIST") throw error;}
      } finally {await handle?.close(); await unlink(temporary).catch(error => {if (error.code !== "ENOENT") throw error;});}
    },
    async get(key, maxBytes, signal) {
      signal.throwIfAborted(); await checkRoot();
      const target = filename(key);
      return readBoundedLocalFile(target, maxBytes, signal);
    },
  });
}


/** Fixed-size reads; never allocate from unchecked file contents. */
export async function readBoundedLocalFile(target, maxBytes, signal) {
  signal.throwIfAborted();
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 50_000_000) fail("OUTPUT_READ_LIMIT");
  const stat = await lstat(target).catch(error => {if (error.code === "ENOENT") return null; throw error;});
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) fail("OUTPUT_READ_LIMIT");
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.size > maxBytes || actual.dev !== stat.dev || actual.ino !== stat.ino) fail("OUTPUT_FILE_CHANGED");
    const bytes = Buffer.alloc(actual.size);
    let offset = 0;
    while (offset < bytes.length) {
      signal.throwIfAborted();
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) fail("OUTPUT_FILE_CHANGED");
      offset += result.bytesRead;
    }
    if ((await handle.stat()).size !== actual.size) fail("OUTPUT_FILE_CHANGED");
    signal.throwIfAborted(); return bytes;
  } finally {await handle.close();}
}
