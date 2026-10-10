/* eslint-disable @typescript-eslint/no-require-imports -- Offline policy and route integration checks. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, modules = {}, env = {}) {
  const source = fs.readFileSync(path.resolve(file), "utf8");
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const context = {exports: {}, Request, Response, Headers, URL, process: {env}, require: name => {
    if (name === "server-only") return {};
    if (Object.hasOwn(modules, name)) return modules[name];
    throw new Error(`Unexpected dependency in capability check: ${name}`);
  }};
  vm.runInNewContext(compiled, context, {filename: file});
  return context.exports;
}

const policy = load("src/lib/capabilities/snapshot.ts");
const enabledCloud = {enabled: true, configured: true, migrationsVerified: true, reason: null};
const input = {environment: "production", hostname: "makeborne.com", administrator: true, cloud: enabledCloud, pilotProviderConfigured: true, hostingCredentialConfigured: true, billingConfigured: true, billingEnabledByConfiguration: true, routing: {configured: 0, total: 8}};
let checks = 0;
function check(name, run) {run(); checks++; console.log(`PASS ${name}`);}

check("configured administrator pilot remains closed pending durable worker", () => {
  const result = policy.capabilitySnapshot(input);
  assert.equal(result.operations.pilot.available, false);
  assert.equal(result.public.aiGeneration.available, false);
  assert.equal(result.operations.pilot.health, "unverified");
  assert.equal(result.operations.pilot.budget, "closed_pending_durable_worker");
  assert.equal(result.operations.routing.configured, 0);
});
for (const administrator of [false, true]) for (const configured of [false, true]) for (const enabled of [false, true]) {
  check(`legacy pilot cannot be enabled by role or configuration: ${administrator}/${configured}/${enabled}`, () => {
    const result = policy.generationPilotStatus({...input, administrator, pilotProviderConfigured: configured, cloud: {...enabledCloud, enabled}});
    assert.equal(result.available, false);
    assert.equal(result.health, "unverified");
  });
}
for (const hostname of ["localhost", "127.0.0.1", "[::1]", "makeborne.com", "localhost.evil.example", "192.168.1.2", undefined]) {
  for (const environment of ["development", "production"]) {
    check(`export gate matches host/environment: ${environment}/${hostname}`, () => {
      const result = policy.capabilitySnapshot({...input, environment, hostname});
      assert.equal(result.public.manualExports.available, environment !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(hostname));
    });
  }
}
check("flags do not certify delivery or activate unfinished credits", () => {
  const result = policy.capabilitySnapshot(input);
  assert.equal(result.public.payments.available, false);
  assert.equal(result.public.payments.support.grantsCreationAccess, false);
  assert.equal(result.operations.billing.enabledByConfiguration, true);
  assert.equal(result.operations.billing.creditFulfilmentReady, false);
  assert.equal(result.operations.hosting.configured, true);
  assert.equal(result.operations.hosting.health, "unverified");
  assert.equal(result.public.publicPublishing.available, false);
  assert.equal(result.public.cloudWorkspace.migrationEvidence, "operator_acknowledgement");
});
check("public snapshot cannot contain account-specific pilot state", () => {
  const publicA = JSON.stringify(policy.capabilitySnapshot({...input, administrator: true}).public);
  const publicB = JSON.stringify(policy.capabilitySnapshot({...input, administrator: false, pilotProviderConfigured: false, billingConfigured: false, hostingCredentialConfigured: false}).public);
  assert.equal(publicA, publicB);
  assert(!publicA.includes("Paid API calls are not authorised"));
});

function serverSnapshot(env = {}) {
  return load("src/lib/capabilities/server.ts", {
    "@/lib/cloud/config": {getCloudStatus: () => enabledCloud},
    "@/lib/billing/config": {billingConfig: () => ({configured: true, enabled: true, apiKey: "billing-secret-must-not-leak", secretKey: "database-secret-must-not-leak"})},
    "@/lib/routing/registry": {PLANNED_ROUTES: [{status: "unconfigured"}, {status: "paused"}]},
    "./snapshot": policy,
  }, {NODE_ENV: "production", ANTHROPIC_API_KEY: "provider-secret-must-not-leak", SUPABASE_SECRET_KEY: "sb_secret_do_not_leak", ...env});
}
check("server snapshot projects safe values without credentials", () => {
  const result = serverSnapshot().getCapabilities({administrator: true});
  const encoded = JSON.stringify(result);
  for (const value of ["billing-secret", "database-secret", "provider-secret", "sb_secret_do_not_leak"]) assert(!encoded.includes(value));
  assert.equal(result.operations.routing.configured, 1);
  assert.equal(result.operations.routing.total, 2);
});
check("whitespace provider configuration cannot enable testing", () => {
  assert.equal(serverSnapshot({ANTHROPIC_API_KEY: "  "}).getCapabilities({administrator: true}).operations.pilot.available, false);
});
check("public route ignores administrator query flags and excludes operations", () => {
  const server = serverSnapshot();
  const route = load("src/app/api/capabilities/route.ts", {"@/lib/capabilities/server": server});
  const response = route.GET(new Request("https://makeborne.com/api/capabilities?administrator=true"));
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(route.dynamic, "force-dynamic");
});

async function checkRoutes() {
  const server = serverSnapshot();
  const publicRoute = load("src/app/api/capabilities/route.ts", {"@/lib/capabilities/server": server});
  const publicBody = await publicRoute.GET(new Request("https://makeborne.com/api/capabilities?administrator=true")).json();
  assert(!Object.hasOwn(publicBody, "operations"));
  assert.equal(publicBody.aiGeneration.available, false);
  assert.equal(publicBody.manualExports.available, false);
  checks++;

  for (const state of ["signed_out", "ordinary", "administrator"]) {
   for(const previewsConfigured of [false,true]) {
    let privilegeReads = 0;
    const route = load("src/app/api/generate/route.ts", {
      "@/lib/account/privileges": {getAccountPrivileges: async userId => {assert.equal(userId, "verified-user"); privilegeReads++; return {isAdmin: state === "administrator"};}},
      "@/lib/server/http": {},
      "@/lib/cloud/server": {},
      "@/lib/billing/access": {billingUser: async () => state === "signed_out" ? null : {id: "verified-user"}},
      "@/lib/generation/pilot-contract": {},
      "@/lib/generation/claude-pilot": {generatePilotDraft: () => {throw new Error("A status check must never dispatch paid work.");}},
      "@/lib/generation/submission-server": {submitGeneration: () => {throw new Error("A status check must not submit work.");}},
      "@/lib/projects/preview-session-server": {privatePreviewsConfigured:()=>previewsConfigured},
      "@/lib/capabilities/server": server,
    });
    const response = await route.GET();
    const body = await response.json();
    assert.equal(body.available, false);
    assert.equal(body.scope, "administrator_testing");
    assert.equal(body.health, "unverified");
    assert.equal(body.privatePreviewsEnabled,state!=="signed_out"&&previewsConfigured);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Vary"), "Cookie");
    assert.equal(privilegeReads, state === "signed_out" ? 0 : 1);
    checks++;
    console.log(`PASS private generation status for ${state}, private preview configuration ${previewsConfigured}`);
   }
  }
}

async function checkAdmin() {
  const React = require("react");
  const {renderToStaticMarkup} = require("react-dom/server");
  for (const state of ["signed_out", "ordinary", "administrator"]) {
    for (const providerConfigured of [false, true]) {
      let snapshotReads = 0;
      const page = load("src/app/admin/page.tsx", {
        "react/jsx-runtime": require("react/jsx-runtime"),
        "next/link": {default: ({children, ...props}) => React.createElement("a", props, children)},
        "next/navigation": {redirect: value => {throw new Error(`redirect:${value}`);}, notFound: () => {throw new Error("not_found");}},
        "lucide-react": require("lucide-react"),
        "@/components/brand-mark": {default: () => React.createElement("span", null, "Makeborne")},
        "@/lib/account/privileges": {getAccountPrivileges: async () => ({isAdmin: state === "administrator", unlimitedCredits: true})},
        "@/lib/billing/access": {billingUser: async () => state === "signed_out" ? null : {id: "verified-user"}},
        "@/lib/capabilities/server": {getCapabilities: options => {
          snapshotReads++;
          assert.equal(state, "administrator");
          assert.equal(options.administrator, true);
          return policy.capabilitySnapshot({...input, pilotProviderConfigured: providerConfigured});
        }},
        "./admin.css": {},
      });
      if (state === "signed_out") await assert.rejects(page.default, /redirect:\/login/);
      else if (state === "ordinary") await assert.rejects(page.default, /not_found/);
      else {
        const html = renderToStaticMarkup(await page.default());
        assert(html.includes("Pilot unavailable"));
        assert(html.includes("Provider spending limits still apply."));
        assert(html.includes("Verify an authorised publish"));
        assert(html.includes("Credit delivery incomplete"));
        assert(!html.includes("Generation remains disabled, including for administrators"));
        assert(!html.includes("Automatic deployment and domain management are not connected"));
      }
      assert.equal(snapshotReads, state === "administrator" ? 1 : 0);
      checks++;
      console.log(`PASS admin role/render boundary for ${state}, provider configured ${providerConfigured}`);
    }
  }
}

async function checkCreationGate() {
  class RequestError extends Error {constructor(code, message, status) {super(message); this.code=code; this.status=status;}}
  const submission = load("src/lib/generation/submission-server.ts", {
    zod:require("zod"),
    "../cloud/server": {cloudContext:async()=>({user:{id:"verified-administrator"},client:{auth:{getClaims:async()=>({data:{claims:{sub:"verified-administrator",session_id:"11111111-1111-4111-8111-111111111111",exp:Math.floor(Date.now()/1000)+300,role:"authenticated",is_anonymous:false}},error:null})}}}),cloudBody:()=>{throw Error("Closed submission parsed content");}},
    "../cloud/request-account": {requestAccountMatches:()=>true},
    "../billing/database": {billingDatabase:()=>{throw Error("Closed submission reached service database");}},
    "../billing/access": {requireCreationAccess:async()=>({id:"verified-administrator"})},
    "../account/privileges": {getAccountPrivileges:async()=>({isAdmin:true})},
    "../server/http": {RequestError,sameOrigin:()=>{}},
    "../routing/proposal": {},"./submission-contract": {},
  });
  const route = load("src/app/api/generate/route.ts", {
    "@/lib/account/privileges": {getAccountPrivileges: async () => ({isAdmin: true})},
    "@/lib/billing/access": {requireCreationAccess: async () => ({id: "verified-administrator"})},
    "@/lib/server/http": {sameOrigin: () => {}, boundedJson: () => {throw new Error("Closed dispatch must not read a brief");}, RequestError, apiError: error => Response.json({code:error.code}, {status:error.status})},
    "@/lib/cloud/server": {cloudError:error=>Response.json({code:error.code},{status:error.status})},
    "@/lib/generation/pilot-contract": {},
    "@/lib/generation/claude-pilot": {generatePilotDraft: () => {throw new Error("Closed route reached paid provider");}},
    "@/lib/generation/submission-server": submission,
    "@/lib/projects/preview-session-server": {privatePreviewsConfigured:()=>false},
    "@/lib/capabilities/server": {getCapabilities: options => {assert.equal(options.administrator,true); return policy.capabilitySnapshot(input);}},
  });
  const response = await route.POST(new Request("https://makeborne.com/api/generate", {method:"POST"}));
  assert.equal(response.status,503); assert.equal((await response.json()).code,"GENERATION_NOT_ENABLED");
  checks++; console.log("PASS verified administrator POST stops before brief parsing or paid dispatch");
  const preparation = load("src/lib/generation/preparation-server.ts", {
    zod:require("zod"),
    "../cloud/server": {cloudBody:()=>{throw Error("Closed preparation parsed content");}},
    "../billing/database": {billingDatabase:()=>{throw Error("Closed preparation reached service database");}},
    "../server/http": {RequestError,sameOrigin:()=>{}},
    "./submission-server": submission,
    "./submission-contract": {}, "./prepare-saved-website": {},
  });
  await assert.rejects(preparation.prepareGeneration(new Request("https://makeborne.com/api/generate/prepare", {method:"POST"})),
    error=>error.code==="GENERATION_NOT_ENABLED"&&error.status===503);
  checks++; console.log("PASS preparation shares the default closed administrator gate before content, policy or database work");
}
checkRoutes().then(checkAdmin).then(checkCreationGate).then(() => console.log(`${checks} capability checks passed; no external requests or paid dispatch.`)).catch(error => {console.error(error); process.exitCode = 1;});
