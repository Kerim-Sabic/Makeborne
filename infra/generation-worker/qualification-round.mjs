/** Local operator tooling only. No app route imports this module. Reuses the
 * existing budget/usage ledger; never resets spent, reserved or unknown costs. */
import assert from "node:assert/strict";

export const qualificationRound = Object.freeze({
  id: "claude-design-round-1", maximumVendorMicrousd: "25000000",
  workspaceId: "91c76d20-dacd-4daf-a091-0c7e72f94a31",
  ownerId: "91c76d20-dacd-4daf-a091-0c7e72f94a32",
  name: "Makeborne operator Claude design qualification round 1",
  email: "makeborne-claude-design-round-1@example.invalid",
});
export function assertLocalQualificationDatabase(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55322");
  assert.equal(url.pathname, "/postgres");
  return url;
}

async function transaction(db, operation) {
  await db.query("begin");
  try {const result = await operation(); await db.query("commit"); return result;}
  catch (error) {await db.query("rollback"); throw error;}
}

/** Caller holds a session advisory lock for this round throughout its process.
 * Initialization is idempotent and does not enable a provider or public access. */
export async function initializeQualificationRound(db, localUrl) {
  assertLocalQualificationDatabase(localUrl);
  return transaction(db, async () => {
    const r = qualificationRound;
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`initialize:${r.id}`]);
    const existing = (await db.query("select name,owner_id from public.workspaces where id=$1 for update", [r.workspaceId])).rows[0];
    if (!existing) {
      // Deliberately unloginable local operator identity, not a customer account.
      await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [r.ownerId,r.email]);
      await db.query("insert into public.workspaces(id,name,owner_id) values($1,$2,$3)", [r.workspaceId,r.name,r.ownerId]);
      await db.query("insert into makeborne_private.generation_budgets(workspace_id,vendor_limit,credit_limit,concurrency_limit) values($1,$2,0,1)", [r.workspaceId,r.maximumVendorMicrousd]);
    } else {
      assert.equal(existing.name,r.name); assert.equal(existing.owner_id,r.ownerId);
    }
    const identity = (await db.query("select email,deleted_at,banned_until,is_anonymous from auth.users where id=$1", [r.ownerId])).rows[0];
    assert(identity && identity.email===r.email && !identity.deleted_at && !identity.banned_until && !identity.is_anonymous);
    const budget = (await db.query("select * from makeborne_private.generation_budgets where workspace_id=$1 for update", [r.workspaceId])).rows[0];
    assert(budget && budget.vendor_limit===r.maximumVendorMicrousd && budget.credit_limit==='0' && budget.concurrency_limit===1);
    assert(!budget.spending_enabled && !budget.emergency_stop);
    assert.equal(budget.vendor_reserved,'0'); assert.equal(budget.credit_reserved,'0'); assert.equal(budget.active_reservations,0);
    assert(BigInt(budget.vendor_spent)<=BigInt(r.maximumVendorMicrousd));
    const unresolved = (await db.query("select count(*)::int n from makeborne_private.generation_reservations where workspace_id=$1 and status in ('reserved','uncertain')", [r.workspaceId])).rows[0].n;
    assert.equal(unresolved,0); // Unknowns require reconciliation, never a fresh paid attempt.
    return {workspaceId:r.workspaceId, vendorSpent:budget.vendor_spent, maximumVendorMicrousd:budget.vendor_limit};
  });
}

export async function enableQualificationSpending(db) {
  return transaction(db, async () => {
    const r=qualificationRound;
    const budget=(await db.query("select * from makeborne_private.generation_budgets where workspace_id=$1 for update",[r.workspaceId])).rows[0];
    assert(budget && !budget.spending_enabled && !budget.emergency_stop && budget.vendor_limit===r.maximumVendorMicrousd
      && budget.vendor_reserved==='0' && budget.active_reservations===0 && budget.credit_limit==='0');
    // Same lock order as the original dispatch authority: workspace budget,
    // global cap, then provider. Refuse a different running/test policy.
    const rows=[];
    for(const scope of ['global','anthropic']) rows.push((await db.query('select * from makeborne_private.generation_execution_caps where scope=$1 for update',[scope])).rows[0]);
    for(const cap of rows) {
      assert(cap && !cap.enabled && !cap.emergency_stop && cap.vendor_reserved==='0' && cap.active_dispatches===0);
      assert(cap.vendor_limit==='0' || cap.vendor_limit===r.maximumVendorMicrousd);
      assert(BigInt(cap.vendor_spent)<=BigInt(r.maximumVendorMicrousd));
    }
    await db.query("update makeborne_private.generation_budgets set spending_enabled=true,revision=revision+1 where workspace_id=$1",[r.workspaceId]);
    await db.query("update makeborne_private.generation_execution_caps set enabled=true,vendor_limit=$1,concurrency_limit=1,revision=revision+1 where scope in ('global','anthropic')",[r.maximumVendorMicrousd]);
  });
}

export async function stopQualificationSpending(db) {
  return transaction(db, async () => {
    await db.query('update makeborne_private.generation_budgets set spending_enabled=false,revision=revision+1 where workspace_id=$1',[qualificationRound.workspaceId]);
    for(const scope of ['global','anthropic']) await db.query('update makeborne_private.generation_execution_caps set enabled=false,revision=revision+1 where scope=$1',[scope]);
  });
}
