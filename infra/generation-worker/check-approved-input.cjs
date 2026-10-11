/* eslint-disable @typescript-eslint/no-require-imports -- Offline cross-contract integrity qualification. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict"), {randomUUID} = require("node:crypto");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText, filename);
const {prepareGenerationProposal} = require("../../src/lib/routing/proposal.ts");
const {PLANNED_ROUTES} = require("../../src/lib/routing/registry.ts");
const now = "2026-10-08T15:00:00.000Z", expiresAt = "2026-10-08T15:30:00.000Z";
const route = {...PLANNED_ROUTES[0], model: "fixture", status: "ready", adapterVerified: true, configurationRef: "fixture-ref", policyApproved: true, licenseApproved: true,
  evaluation: {evidenceId: "fixture", quality: 90}, price: {version: "fixture", evidenceId: "fixture", expiresAt, lines: [{unit: "input_tokens", perUnits: "1", vendorMicrousd: "1", customerCredits: "1"}], fixedVendorMicrousd: "0", fixedCustomerCredits: "0"}};
const step = {capabilities: ["text"], usage: [{unit: "input_tokens", maximum: "1"}], maximumAttempts: 1, minimumQuality: 80, allowedProviders: ["openai"], externalProcessingAllowed: true, sourceRightsConfirmed: true, maximumVendorMicrousd: "1000", maximumCustomerCredits: "1000", preference: "quality", now};
const preparation = {output: "website", effort: "medium", includeImages: false, now, maximumVendorMicrousd: "1000", maximumCustomerCredits: "1000", stages: ["planning", "draft", "review"].map(stage => ({stage, request: step}))};
const sourceId = randomUUID();
const input = {scope: {workspaceId: randomUUID(), projectId: randomUUID(), artifactId: randomUUID()}, baseVersionId: null, brief: "Expressive makeup. é 😀 \n Exact whitespace.", audience: "Performers", purpose: "Explore", sourceIds: [sourceId],
  content: {schemaVersion: 1, title: "Stage", kind: "website", sections: []}, style: {id: "automatic", name: "Automatic", version: 1, typography: {headingFont: "Inter", bodyFont: "Inter"}, colors: {ink: "#111111"}, description: "", referenceAssetIds: []}};
const proposal = prepareGenerationProposal(input, preparation, [route]).proposal;
const lease = {workspaceId: input.scope.workspaceId, deadlineAt: expiresAt};
const raw = {proposal, actorId: randomUUID(), authorizationExpiresAt: expiresAt, sourceMaterial: [{id: sourceId, title: "Approved notes", text: "Exact notes."}]};
let count = 0;
function check(name, fn) {fn(); count++; console.log(`PASS ${name}`);}
(async () => {
  const {approvedGenerationInput} = await import("./approved-input.mjs");
  const validate = (value, at = Date.parse(now), receipt = lease) => approvedGenerationInput(receipt, value, at);
  check("real TypeScript proposal digest matches separate worker JSON digest including Unicode", () => assert.equal(validate(raw).proposal.approvalHash, proposal.approvalHash));
  check("worker input is deeply immutable", () => {const value = validate(structuredClone(raw)); assert(Object.isFrozen(value.proposal.input.style.colors)); assert(Object.isFrozen(value.sourceMaterial[0]));});
  for (const [name, mutate] of [
    ["brief tampering", value => {value.proposal.input.brief += "changed";}],
    ["price tampering", value => {value.proposal.workflow.maximumVendorMicrousd = "0";}],
    ["approval tampering", value => {value.proposal.approvalHash = "0".repeat(64);}],
    ["missing source", value => {value.sourceMaterial = [];}],
    ["foreign source", value => {value.sourceMaterial[0].id = randomUUID();}],
    ["duplicate source", value => {value.sourceMaterial.push({...value.sourceMaterial[0]});}],
    ["authorization beyond deadline", value => {value.authorizationExpiresAt = "2026-10-08T16:00:00.000Z";}],
    ["malformed expiry", value => {value.authorizationExpiresAt = "invalid";}],
  ]) check(`${name} rejected before executor`, () => {const value = structuredClone(raw); mutate(value); assert.throws(() => validate(value), /WORKER_APPROVED_INPUT_INVALID/);});
  check("expired authorization boundary rejected", () => assert.throws(() => validate(structuredClone(raw), Date.parse(expiresAt)), /WORKER_APPROVED_INPUT_INVALID/));
  check("future preparation rejected", () => assert.throws(() => validate(structuredClone(raw), Date.parse(now)-1), /WORKER_APPROVED_INPUT_INVALID/));
  check("queue workspace substitution rejected", () => assert.throws(() => validate(structuredClone(raw), Date.parse(now), {...lease, workspaceId: randomUUID()}), /WORKER_APPROVED_INPUT_INVALID/));
  console.log(`${count} approved worker input groups passed; no database or provider calls.`);
})().catch(error => {console.error(error); process.exitCode = 1;});
