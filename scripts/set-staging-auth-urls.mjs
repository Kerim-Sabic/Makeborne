// Points STAGING Supabase Auth (Site URL and callback allowlist) at one exact staging preview.
// Refuses any project other than staging. Uses the owner's Supabase CLI login token; never prints it.
// Usage: node scripts/set-staging-auth-urls.mjs https://makeborne-release-staging-<id>-kerimsabic-6594s-projects.vercel.app
import fs from "node:fs";
import os from "node:os";
import assert from "node:assert/strict";

const STAGING_REF = "xzwikrunwpurxnxgkznh";
const origin = process.argv[2];
assert.match(origin ?? "", /^https:\/\/makeborne-release-staging-[a-z0-9]+-kerimsabic-6594s-projects\.vercel\.app$/, "Pass the exact staging preview origin");
const token = fs.readFileSync(os.homedir() + "/.supabase/access-token", "utf8").trim();
const url = `https://api.supabase.com/v1/projects/${STAGING_REF}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const read = async () => { const r = await fetch(url, { headers }); assert.equal(r.status, 200, "Could not read staging auth config"); const j = await r.json(); return { site_url: j.site_url, uri_allow_list: j.uri_allow_list }; };
const before = await read();
const desired = { site_url: origin, uri_allow_list: `${origin}/auth/callback` };
const patched = await fetch(url, { method: "PATCH", headers, body: JSON.stringify(desired) });
assert.equal(patched.status, 200, `PATCH failed with ${patched.status}`);
const after = await read();
assert.deepEqual(after, desired, "Staging auth config did not take the new values");
const report = { project: STAGING_REF, productionTouched: false, changedAt: new Date().toISOString(), before, after };
fs.writeFileSync("docs/release-review/staging-auth-urls.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
