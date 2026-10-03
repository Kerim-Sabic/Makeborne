/** Read-only setup checks. Never prints credentials, response bodies or URLs. */
const online = process.argv.includes("--online");
const env = process.env;
const problems = [];
const report = (label, valid) => {
  console.log(`${valid ? "PASS" : "MISSING/INVALID"}: ${label}`);
  if (!valid) problems.push(label);
};
let base;
try {
  base = new URL(env.NEXT_PUBLIC_SUPABASE_URL || "");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if ((!local && base.protocol !== "https:") || (local && !["https:", "http:"].includes(base.protocol)) || base.username || base.password || base.search || base.hash || base.pathname !== "/") base = undefined;
} catch { base = undefined; }
report("Supabase root URL uses HTTPS (or local HTTP)", Boolean(base));
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
report("Publishable key uses the supported sb_publishable_ format", /^sb_publishable_[A-Za-z0-9_-]+$/.test(key));
const publicSecret = Object.entries(env).some(([name, value]) => name.startsWith("NEXT_PUBLIC_") && (/SECRET|SERVICE_ROLE|DATABASE_PASSWORD|PRIVATE_KEY/.test(name) && Boolean(value) || /^sb_secret_/.test(value || "")));
report("No obvious privileged credentials in public environment variables", !publicSecret);
console.log(`Cloud enable flag: ${env.MAKEBORNE_CLOUD_ENABLED === "true" ? "ON" : "OFF"}`);
console.log(`Migration verification flag: ${env.MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED === "true" ? "ON (a declaration, not evidence)" : "OFF"}`);
if (problems.length) {
  console.log("NOT READY: fix configuration before connecting. No network requests were made.");
  process.exitCode = 2;
} else if (!online) {
  console.log("CONFIGURATION SHAPE ONLY: no network request, identity, database, RLS, email or storage verification performed.");
  process.exitCode = 2;
} else if (!env.MAKEBORNE_VERIFY_OWNER_A_TOKEN) {
  console.log("NOT RUN: --online needs an authorized development owner session token in MAKEBORNE_VERIFY_OWNER_A_TOKEN.");
  process.exitCode = 2;
} else {
  const token = env.MAKEBORNE_VERIFY_OWNER_A_TOKEN;
  async function read(path, method = "GET") {
    const response = await fetch(new URL(path, base), {
      method, redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, data };
  }
  try {
    const auth = await read("/auth/v1/user");
    report("Provider verifies the supplied session", auth.ok && typeof auth.data?.id === "string");
    if (!problems.length) {
      // This RPC is a stable read-only schema probe, not a migration operation.
      const schema = await read("/rest/v1/rpc/makeborne_cloud_schema_version", "POST");
      report("Applied schema probe is 20261003_cloud_v2", schema.ok && schema.data === "20261003_cloud_v2");
    }
    process.exitCode = problems.length ? 1 : 0;
    console.log("This preflight does not establish launch readiness. Run verify-isolation.mjs and the full activation matrix before setting verification flags.");
  } catch {
    console.log("FAILED: provider request could not complete. Check connection and configuration privately; details are intentionally omitted.");
    process.exitCode = 1;
  }
}
