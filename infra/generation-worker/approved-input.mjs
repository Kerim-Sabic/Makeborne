import {createHash} from "node:crypto";
import {canonicalRuntimeJson} from "../project-runtime/identity.mjs";

const digest = value => createHash("sha256").update(canonicalRuntimeJson(value), "utf8").digest("hex");
const invalid = () => {throw Object.assign(new Error("WORKER_APPROVED_INPUT_INVALID"), {code: "WORKER_APPROVED_INPUT_INVALID"});};
function freeze(value) {
  if (value && typeof value === "object") {Object.values(value).forEach(freeze); Object.freeze(value);}
  return value;
}

/** Integrity check of a JSON result fetched through the scoped DB loader. This
 * is not a signature, source-rights determination or provider output schema.
 * The executor must still validate the format-specific generation context.
 * Database authority is repeated at dispatch; this object cannot authorise it. */
export function approvedGenerationInput(lease, raw, now = Date.now()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Number.isFinite(now)) invalid();
  const proposal = raw.proposal;
  if (!proposal || proposal.version !== "generation-proposal-v1" || !proposal.input || !proposal.workflow
    || proposal.workflow.version !== "workflow-v1" || proposal.workflow.approved !== false) invalid();
  const {approvalHash, ...payload} = proposal;
  if (typeof approvalHash !== "string" || !/^[a-f0-9]{64}$/.test(approvalHash)
    || digest(payload) !== approvalHash || digest(proposal.input) !== proposal.inputHash) invalid();
  const prepared = Date.parse(proposal.workflow.preparedAt), expires = Date.parse(proposal.workflow.expiresAt);
  const authorised = Date.parse(raw.authorizationExpiresAt), deadline = Date.parse(lease.deadlineAt);
  if (![prepared, expires, authorised, deadline].every(Number.isFinite) || now < prepared
    || now >= expires || now >= authorised || authorised > deadline || authorised > expires
    || proposal.input.scope?.workspaceId !== lease.workspaceId) invalid();
  const ids = proposal.input.sourceIds, sources = raw.sourceMaterial;
  if (!Array.isArray(ids) || !Array.isArray(sources) || ids.length !== sources.length
    || new Set(ids).size !== ids.length || new Set(sources.map(source => source?.id)).size !== ids.length
    || sources.some(source => !source || !ids.includes(source.id) || typeof source.title !== "string" || typeof source.text !== "string")) invalid();
  return freeze(raw);
}
