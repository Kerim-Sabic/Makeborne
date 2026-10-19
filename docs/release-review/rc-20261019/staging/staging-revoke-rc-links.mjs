// Turns off the review links this rehearsal created in the staging QA workspace (recipient "RC staging check").
import fs from "node:fs"; import assert from "node:assert/strict"; import { createServerClient } from "@supabase/ssr";
const ORIGIN = "https://makeborne-release-staging-qa2026101-kerimsabic-6594s-projects.vercel.app", REF = "xzwikrunwpurxnxgkznh", WID = "521a8417-644b-4bfa-938b-de9317834dbb";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const fx = read("work/release-auth-stack/cloud-hosting-fixture.json"); assert.equal(fx.wid, WID);
const key = read("work/release-auth-stack/cloud-api-keys.json").keys.find(k => k.type === "legacy" && k.name === "anon");
const bypass = read("C:/Users/kerim/Documents/Codex/2026-10-03/referenced-chatgpt-conversation-this-is-an/work/makeborne-app/work/publication-cloud-e2e-20261014/staging-protection.json").secret;
const jar = new Map(); const sb = createServerClient(`https://${REF}.supabase.co`, key.api_key, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: v => v.forEach(({ name, value }) => jar.set(name, value)) } });
assert(!(await sb.auth.signInWithPassword({ email: fx.email, password: fx.password })).error);
const h = () => ({ Origin: ORIGIN, "x-vercel-protection-bypass": bypass, "X-Makeborne-Account": fx.uid, Cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; ") });
const results = [];
for (const aid of ["d1fbb97a-e50a-4da0-9808-4fe4321e37cf", "acc2df0c-c36c-453d-b54a-a5c811ed79ca"]) {
  const list = await (await fetch(`${ORIGIN}/api/cloud/workspaces/${WID}/artifacts/${aid}/reviews`, { headers: h() })).json();
  for (const link of (list.links ?? []).filter(l => l.recipientName === "RC staging check")) {
    const r = await fetch(`${ORIGIN}/api/cloud/workspaces/${WID}/artifacts/${aid}/reviews/${link.id}`, { method: "DELETE", headers: h() });
    const body = await r.json().catch(() => null);
    results.push({ artifact: aid, link: link.id, status: r.status, revoked: body?.link?.revokedAt ?? body?.link?.status ?? null });
  }
}
console.log(JSON.stringify(results, null, 2));
