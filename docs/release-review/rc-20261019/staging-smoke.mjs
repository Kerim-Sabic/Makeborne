// Staging smoke for the frozen candidate on the QA alias (staging only; production is never addressed).
// Signs in as the existing QA agency fixture (operator file, staging project only), then reads:
// public pages and headers, builder availability, capabilities, the QA workspace's projects and one
// saved artifact, credits, and the admin-free telemetry endpoint. No generation, no publish, no purchase.
// Run from the LF snapshot directory (operator files reached through its work/release-auth-stack link).
// Output: work/rc-stack/staging/staging-smoke.json (ids and statuses only).
import fs from "node:fs";
import assert from "node:assert/strict";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";

const ORIGIN = "https://makeborne-release-staging-qa2026101-kerimsabic-6594s-projects.vercel.app", REF = "xzwikrunwpurxnxgkznh", WID = "521a8417-644b-4bfa-938b-de9317834dbb";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const fixture = read("work/release-auth-stack/cloud-hosting-fixture.json");
assert.equal(fixture.wid, WID, "fixture is not the staging QA workspace");
const key = read("work/release-auth-stack/cloud-api-keys.json").keys.find(k => k.type === "legacy" && k.name === "anon");
assert.equal(JSON.parse(Buffer.from(key.api_key.split(".")[1], "base64url")).ref, REF, "key is not for the staging project");
const protection = read("C:/Users/kerim/Documents/Codex/2026-10-03/referenced-chatgpt-conversation-this-is-an/work/makeborne-app/work/publication-cloud-e2e-20261014/staging-protection.json").secret;
const jar = new Map();
const supabase = createServerClient(`https://${REF}.supabase.co`, key.api_key, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(({ name, value }) => jar.set(name, value)) } });
const out = { at: new Date().toISOString(), origin: ORIGIN, candidate: "a6e70c6f577aa5bf7654e72cd8d85b9977bd247e", productionTouched: false, checks: {} };
const headers = (extra = {}) => ({ Origin: ORIGIN, "x-vercel-protection-bypass": protection, Cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; "), ...extra });
async function get(path, { auth = true } = {}) {
  const response = await fetch(ORIGIN + path, { headers: auth ? headers({ "X-Makeborne-Account": fixture.uid }) : { "x-vercel-protection-bypass": protection }, redirect: "manual", signal: AbortSignal.timeout(60000) });
  const text = await response.text(); let body = null; try { body = JSON.parse(text); } catch { /* html */ }
  return { status: response.status, body, text, headers: Object.fromEntries(["x-robots-tag", "content-security-policy", "strict-transport-security", "x-frame-options", "location"].map(h => [h, response.headers.get(h)])) };
}
for (const path of ["/", "/help", "/help/publish-your-website", "/help/make-a-book-with-ai", "/billing", "/robots.txt"]) {
  const r = await get(path, { auth: false });
  out.checks[`public ${path}`] = { status: r.status, headers: r.headers, printReady: /print-ready/i.test(r.text), liveInSeconds: /live in seconds/i.test(r.text) };
}
{ const r = await get("/api/build", { auth: false }); out.checks["GET /api/build"] = { status: r.status, availability: r.body && { available: r.body.available, configured: r.body.configured, state: r.body.state }, estimates: Boolean(r.body?.estimates) }; }
{ const r = await get("/api/capabilities", { auth: false }); out.checks["GET /api/capabilities"] = { status: r.status, manualExports: r.body?.manualExports?.available ?? null, publicPublishing: r.body?.publicPublishing?.configured ?? null }; }
const login = await supabase.auth.signInWithPassword({ email: fixture.email, password: fixture.password });
assert(!login.error && login.data.user?.id === fixture.uid, "staging QA agency sign-in failed");
out.checks.signIn = { ok: true, user: fixture.uid };
{ const r = await get(`/api/cloud/workspaces/${WID}`); out.checks["workspace"] = { status: r.status, projects: r.body?.projects?.length ?? null, artifacts: (r.body?.artifacts ?? []).map(a => ({ id: a.id, kind: a.kind, title: a.title, version: a.currentVersion })).slice(0, 12) }; }
{ const r = await get(`/api/cloud/workspaces/${WID}/artifacts/${fixture.aid}`); out.checks["QA website artifact"] = { status: r.status, versions: (r.body?.versions ?? []).map(v => v.number ?? v.versionNumber).slice(0, 5), hasSource: JSON.stringify(r.body ?? {}).includes("websiteSource") }; }
{ const r = await get("/api/credits"); out.checks["credits"] = { status: r.status, body: r.body && { available: r.body.available, unlimited: r.body.unlimited } }; }
{ const r = await fetch(ORIGIN + "/api/telemetry", { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ kind: "visit", page: "/studio" }) }); out.checks["POST /api/telemetry"] = { status: r.status }; }
{ const r = await get("/studio"); out.checks["GET /studio (signed in)"] = { status: r.status, location: r.headers.location }; }
fs.mkdirSync("../staging", { recursive: true });
fs.writeFileSync("../staging/staging-smoke.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
void randomUUID;
