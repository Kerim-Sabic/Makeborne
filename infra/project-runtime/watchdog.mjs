/** A separate process owns the lease, even if the compiler event loop stalls. */
import {spawn} from "node:child_process";
const lifetime = Number(process.env.MAKEBORNE_RUNTIME_TTL_MS ?? 65000);
if (!Number.isInteger(lifetime) || lifetime < 100 || lifetime > 65000) throw new Error("RUNTIME_LEASE_INVALID");
const child = spawn(process.execPath, ["/opt/makeborne/build.mjs"], {stdio: "inherit", detached: true});
let expired = false;
const timer = setTimeout(() => {
  expired = true;
  console.error("RUNTIME_LEASE_EXPIRED");
  try {process.kill(-child.pid, "SIGKILL");} catch {}
}, lifetime);
child.once("error", () => {clearTimeout(timer); process.exit(1);});
child.once("exit", code => {clearTimeout(timer); process.exit(expired ? 124 : code ?? 1);});
