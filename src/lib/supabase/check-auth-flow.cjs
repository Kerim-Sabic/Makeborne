/* eslint-disable @typescript-eslint/no-require-imports -- Offline pure redirect checks. */
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const source = fs.readFileSync(require.resolve("./auth-flow.ts"), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const context = { exports: {}, URLSearchParams, URL };
vm.runInNewContext(output, context);
const { authDestination, emailAuthDestination, passwordRecoveryDestination, billingPlanSelection } = context.exports;
for (const target of [null, "", "https://example.com", "//example.com", "/\\example.com", "/auth/update-password?next=evil", "/adminevil", "/billingevil", "/studioevil"]) assert.equal(authDestination(target), "/studio");
for (const target of ["/studio", "/studio/cloud", "/chat", "/billing", "/admin", "/auth/update-password"]) assert.equal(authDestination(target), target);
assert.equal(authDestination("/admin?role=admin&next=https://evil.example#anything"), "/admin");
assert.equal(authDestination(passwordRecoveryDestination("/admin")), "/auth/update-password?next=%2Fadmin");
const workspace = "12345678-1234-1234-1234-123456789012", artifact = "22345678-1234-1234-1234-123456789012";
for (const tab of ["clients", "projects", "styles", "settings"]) {
  const url = new URL(authDestination(`/studio?tab=${tab}&workspace=${workspace}&artifact=${artifact}&next=https://evil.example`), "https://makeborne.invalid");
  assert.equal(url.pathname, "/studio");
  assert.equal(url.searchParams.get("workspace"), workspace);
  assert.equal(url.searchParams.get("artifact"), artifact);
  assert.equal(url.searchParams.get("tab"), tab);
  assert.equal(url.searchParams.has("next"), false);
}
const draft = `/studio?create=book&from=home&draft=${workspace}&claim=${artifact}`;
const draftResult = new URL(authDestination(draft), "https://makeborne.invalid");
assert.equal(draftResult.searchParams.get("draft"), workspace);
assert.equal(draftResult.searchParams.get("claim"), artifact);
assert.equal(draftResult.searchParams.get("create"), "book");
const billing = `/billing?required=membership&next=${encodeURIComponent(draft)}#support`;
const billingResult = new URL(authDestination(billing), "https://makeborne.invalid");
assert.equal(billingResult.searchParams.get("next"), authDestination(draft));
assert.equal(billingResult.searchParams.get("required"), "membership");
assert.equal(billingResult.hash, "#support");
assert.equal(authDestination("/billing?next=https://evil.example#wrong"), "/billing");
assert.equal(authDestination(`/billing/return?request=${workspace}`), `/billing/return?request=${workspace}`);
assert.equal(authDestination("/billing/return?request=bad"), "/billing");
assert.equal(authDestination("/studio?draft=bad&claim=bad&create=evil&next=https://evil.example"), "/studio");
const origin = "https://makeborne.vercel.app";
assert.equal(emailAuthDestination(`${origin}/auth/callback?next=${encodeURIComponent(draft)}`, origin), authDestination(draft));
assert.equal(emailAuthDestination(`${origin}/auth/callback?next=${encodeURIComponent(billing)}`, origin), authDestination(billing));
assert.equal(emailAuthDestination(`${origin}/auth/callback?next=/auth/update-password`, origin), "/auth/update-password");
const recovery = passwordRecoveryDestination(draft);
assert.equal(authDestination(recovery), recovery);
assert.equal(new URL(recovery, origin).searchParams.get("next"), authDestination(draft));
assert.equal(emailAuthDestination(`${origin}/auth/callback?next=${encodeURIComponent(recovery)}`, origin), recovery);
assert.equal(authDestination("/auth/update-password?next=https://evil.example"), "/studio");
assert.equal(authDestination("/auth/update-password?next=/auth/update-password"), "/studio");
for (const target of [null, "", "https://evil.example/auth/callback?next=/chat", "//evil.example/auth/callback?next=/chat", "/other?next=/chat", `${origin}/auth/callback?next=https://evil.example`]) {
  assert.equal(emailAuthDestination(target, origin), "/studio");
}
// Client portal destinations: home, one site by UUID, one invite by 43-character token; nothing else under /portal.
const portalToken = "abc_DEF-123abc_DEF-123abc_DEF-123abc_DEF-12";
for (const target of ["/portal", `/portal/sites/${artifact}`, `/portal/join/${portalToken}`]) assert.equal(authDestination(target), target);
assert.equal(authDestination(`/portal/sites/${artifact}?next=https://evil.example#x`), `/portal/sites/${artifact}`);
for (const target of ["/portal/", "/portal/admin", "/portal/sites/not-a-uuid", `/portal/sites/${artifact}/extra`, "/portal/join/short", `/portal/join/${portalToken}x`,
  `/portal/join/${portalToken.slice(0, 42)}!`, "/portalevil", "//portal", `/portal/join/../../admin`]) {
  assert.notEqual(authDestination(target).startsWith("/portal"), true, target);
}
assert.equal(emailAuthDestination(`${origin}/auth/callback?next=${encodeURIComponent(`/portal/join/${portalToken}`)}`, origin), `/portal/join/${portalToken}`);
assert.equal(emailAuthDestination(`${origin}/auth/callback?next=${encodeURIComponent("/portal/sites/bad")}`, origin), "/studio");
// A plan chosen before sign-up rides to /billing through allow-listed params, with the brief link nested once.
const planReturn = `/billing?plan=studio&interval=monthly&next=${encodeURIComponent(`/studio?draft=${workspace}`)}#plans`;
const planResult = new URL(authDestination(planReturn), "https://makeborne.invalid");
assert.equal(planResult.searchParams.get("plan"), "studio");
assert.equal(planResult.searchParams.get("interval"), "monthly");
assert.equal(planResult.searchParams.get("next"), `/studio?draft=${workspace}`);
assert.equal(planResult.hash, "#plans");
assert.deepEqual({ ...billingPlanSelection(planReturn) }, { tier: "studio", interval: "monthly" });
// Doubly encoded (the login link wraps the billing link): draft and claim survive exactly.
const nested = `/billing?plan=scale&interval=yearly&next=${encodeURIComponent(draft)}#plans`;
const login = `/login?mode=signup&next=${encodeURIComponent(nested)}`;
const unwrapped = new URL(login, "https://makeborne.invalid").searchParams.get("next");
assert.equal(unwrapped, nested);
const nestedResult = new URL(authDestination(unwrapped), "https://makeborne.invalid");
assert.equal(nestedResult.searchParams.get("next"), authDestination(draft));
assert.equal(new URL(nestedResult.searchParams.get("next"), "https://makeborne.invalid").searchParams.get("claim"), artifact);
assert.equal(authDestination(authDestination(unwrapped)), authDestination(unwrapped), "already-safe links are stable");
assert.equal(emailAuthDestination(`${origin}/auth/callback?next=${encodeURIComponent(nested)}`, origin), authDestination(nested), "the email link keeps the plan");
for (const target of ["/billing?plan=evil&interval=weekly", "/billing?plan=studio", "/billing?interval=monthly", "/billing?plan=studio&interval=weekly", "/billing?plan=STUDIO&interval=monthly"]) {
  assert.equal(authDestination(target), "/billing", target);
  assert.equal(billingPlanSelection(target), null, target);
}
for (const target of [null, "/studio?draft=x", "/billing#plans", "https://evil.example/billing?plan=studio&interval=monthly"]) assert.equal(billingPlanSelection(target), null, String(target));
assert.equal(authDestination("/billing#topups"), "/billing#topups");
assert.equal(authDestination(`/billing?plan=studio&interval=monthly&next=/studio?draft=x#plans`), "/billing?next=%2Fstudio&plan=studio&interval=monthly#plans", "an invalid brief id falls back to /studio; plan and hash are kept");
// Over-long links fall back to /studio; purchase() drops the nested brief link before that limit.
assert.equal(authDestination(`/billing?plan=studio&interval=monthly&next=${encodeURIComponent(`/studio?x=${"a".repeat(2500)}`)}`), "/studio");
console.log("PASS: account, draft, billing, checkout, portal and email return URLs preserved; external and unsupported destinations rejected.");
