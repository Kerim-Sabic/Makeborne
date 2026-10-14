/* eslint-disable @typescript-eslint/no-require-imports -- Offline sales/delivery stage checks. */
const fs = require("node:fs");
const ts = require("typescript");
const path = require("node:path");
const assert = require("node:assert/strict");
const Module = require("node:module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(__dirname, "..", request.slice(2));
  return originalResolve.call(this, request, ...rest);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { outreachStages, closedOutreachStages, LEGACY_OUTREACH_STAGES, ClientOutreachSchema, emptyOutreach, saveOutreach } = require("./client-outreach.ts");
const { projectDeliveryStages, legacyDeliveryStage, deliveryStageAfterReview, deliveryStageLabels, projectStateLabel } = require("./project-delivery.ts");

let passed = 0;
const check = (name, fn) => { fn(); passed++; };

check("sales stages only; delivery is not a client stage", () => {
  assert.deepEqual([...outreachStages], ["Lead", "Contacted", "Conversation", "Proposal", "Won", "Lost"]);
  assert.deepEqual([...closedOutreachStages], ["Won", "Lost"]);
  for (const stage of ["Review", "Delivered", "in_review", "delivered"]) assert.ok(!outreachStages.includes(stage), stage);
});

check("every legacy client stage maps explicitly to a current stage", () => {
  assert.deepEqual({ ...LEGACY_OUTREACH_STAGES }, { Replied: "Conversation", Meeting: "Conversation", Review: "Won", Delivered: "Won" });
  for (const [legacy, current] of Object.entries(LEGACY_OUTREACH_STAGES)) {
    assert.equal(ClientOutreachSchema.parse({ ...emptyOutreach(), stage: legacy }).stage, current, legacy);
  }
  assert.throws(() => ClientOutreachSchema.parse({ ...emptyOutreach(), stage: "Shipped" }));
});

check("the SQL transition maps client stages the same way and accepts the previous app's stages until contracted", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../../supabase/migrations/20261011190000_crm_transition.sql"), "utf8");
  for (const [legacy, current] of Object.entries(LEGACY_OUTREACH_STAGES)) assert.ok(sql.includes(`when '${legacy}' then '${current}'`), legacy);
  assert.ok(sql.includes("('Lead','Contacted','Conversation','Proposal','Won','Lost')"));
  assert.ok(sql.includes("in ('Replied','Meeting') and makeborne_private.crm_legacy_client_stages_allowed()"));
  // The client rewrite is a separate, post-deploy contract step, never part of a migration run.
  assert.ok(!/^select makeborne_private\.crm_contract_client_stages\(\)/m.test(sql));
});

check("a locally stored legacy client saves with a logged, current stage", () => {
  const prior = { ...emptyOutreach(), stage: "Meeting" };
  const next = saveOutreach(prior, { ...emptyOutreach(), stage: "Proposal" }, { id: "6f1c2b7e-1d1a-4c55-9a3b-0c9c6d1e2f31", at: "2026-10-11T10:00:00.000Z" });
  assert.equal(next.stage, "Proposal");
  assert.equal(next.activity.at(-1).text, "Stage: Conversation → Proposal");
});

check("project delivery stages and the legacy status mapping", () => {
  assert.deepEqual([...projectDeliveryStages], ["active", "in_review", "changes_requested", "delivered"]);
  for (const stage of projectDeliveryStages) assert.ok(deliveryStageLabels[stage]);
  assert.equal(legacyDeliveryStage("review"), "in_review");
  assert.equal(legacyDeliveryStage("approved"), "delivered");
  assert.equal(legacyDeliveryStage("in_progress", "changes_requested"), "changes_requested");
  assert.equal(legacyDeliveryStage("in_progress", "approved"), "active");
  for (const status of ["draft", "in_progress", "published", "archived"]) assert.equal(legacyDeliveryStage(status), "active", status);
});

check("review events move only the delivery stage", () => {
  assert.equal(deliveryStageAfterReview("link_sent"), "in_review");
  assert.equal(deliveryStageAfterReview("approved"), "delivered");
  assert.equal(deliveryStageAfterReview("changes_requested"), "changes_requested");
});

check("lists never present stored review/approved as current delivery; lifecycle kept", () => {
  assert.equal(projectStateLabel("review", "active"), "In progress");
  assert.equal(projectStateLabel("approved", "active"), "In progress");
  assert.equal(projectStateLabel("approved", "delivered"), "Delivered");
  assert.equal(projectStateLabel("review", "changes_requested"), "Changes requested");
  assert.equal(projectStateLabel("draft", "active"), "Draft");
  assert.equal(projectStateLabel("published", "active"), "Published");
  assert.equal(projectStateLabel("archived", "delivered"), "Archived");
  assert.equal(projectStateLabel("in_progress", "in_review"), "In review");
});

check("app protocol, header and database cutoff agree; migrations never freeze, contract or roll back", () => {
  const { CRM_PROTOCOL, CRM_PROTOCOL_HEADER, speaksCurrentCrmProtocol } = require("./crm-protocol.ts");
  const sql = fs.readFileSync(path.join(__dirname, "../../supabase/migrations/20261011200000_crm_write_freeze.sql"), "utf8");
  assert.ok(sql.includes(`'${CRM_PROTOCOL_HEADER}'`), "database reads the same header name");
  assert.ok(sql.includes(`min_client_protocol = ${CRM_PROTOCOL}`), "contract cutoff equals the app protocol");
  assert.ok(speaksCurrentCrmProtocol(new Headers({ [CRM_PROTOCOL_HEADER]: String(CRM_PROTOCOL) })));
  assert.ok(!speaksCurrentCrmProtocol(new Headers()) && !speaksCurrentCrmProtocol(new Headers({ [CRM_PROTOCOL_HEADER]: "1" })));
  for (const file of fs.readdirSync(path.join(__dirname, "../../supabase/migrations"))) {
    const text = fs.readFileSync(path.join(__dirname, "../../supabase/migrations", file), "utf8");
    assert.ok(!/^\s*select\s+makeborne_private\.crm_(freeze_writes|contract_client_stages|rollback_client_stages|resume_writes)\(/mi.test(text), `${file} runs a transition step`);
  }
});

console.log(`${passed} sales/delivery stage checks passed.`);
