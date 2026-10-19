// Fetches book PDF, deck PDF and deck PPTX from the candidate's export route on STAGING (Vercel runtime)
// for the QA workspace's saved documents; saves them for inspection. No AI, no publish.
import fs from "node:fs"; import assert from "node:assert/strict"; import { createServerClient } from "@supabase/ssr"; import { createHash } from "node:crypto";
const ORIGIN = "https://makeborne-release-staging-qa2026101-kerimsabic-6594s-projects.vercel.app", REF = "xzwikrunwpurxnxgkznh", WID = "521a8417-644b-4bfa-938b-de9317834dbb";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const fx = read("work/release-auth-stack/cloud-hosting-fixture.json"); assert.equal(fx.wid, WID);
const key = read("work/release-auth-stack/cloud-api-keys.json").keys.find(k => k.type === "legacy" && k.name === "anon");
const bypass = read("C:/Users/kerim/Documents/Codex/2026-10-03/referenced-chatgpt-conversation-this-is-an/work/makeborne-app/work/publication-cloud-e2e-20261014/staging-protection.json").secret;
const jar = new Map(); const sb = createServerClient(`https://${REF}.supabase.co`, key.api_key, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: v => v.forEach(({ name, value }) => jar.set(name, value)) } });
assert(!(await sb.auth.signInWithPassword({ email: fx.email, password: fx.password })).error);
const h = () => ({ Origin: ORIGIN, "x-vercel-protection-bypass": bypass, "X-Makeborne-Account": fx.uid, Cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; ") });
const OUT = "../staging/exports"; fs.mkdirSync(OUT, { recursive: true });
const results = [];
for (const [name, aid, format] of [["staging-book", "426feb56-ef44-4b8a-8b0d-75f011d2e86b", "pdf"], ["staging-deck", "b49012e3-f4c6-4540-9b5f-a246daa5a6cb", "pdf"], ["staging-deck", "b49012e3-f4c6-4540-9b5f-a246daa5a6cb", "pptx"]]) {
  const t0 = Date.now();
  const r = await fetch(`${ORIGIN}/api/cloud/workspaces/${WID}/artifacts/${aid}/document-export?format=${format}`, { headers: h(), signal: AbortSignal.timeout(130000) });
  const bytes = Buffer.from(await r.arrayBuffer());
  if (r.ok) fs.writeFileSync(`${OUT}/${name}.${format}`, bytes);
  results.push({ name, format, status: r.status, type: r.headers.get("content-type"), bytes: bytes.length, sha256: r.ok ? createHash("sha256").update(bytes).digest("hex") : null, ms: Date.now() - t0, error: r.ok ? null : bytes.toString("utf8").slice(0, 200) });
}
fs.writeFileSync(`${OUT}/staging-exports.json`, JSON.stringify({ at: new Date().toISOString(), origin: ORIGIN, results }, null, 2));
console.log(JSON.stringify(results, null, 2));
