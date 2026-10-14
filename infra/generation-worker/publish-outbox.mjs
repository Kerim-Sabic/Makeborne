/** Separate worker module. Caller supplies one checked-out, dedicated SQL client
 * for the whole transaction, never a pool query shortcut or app request client. */
export const GENERATION_QUEUE = "makeborne-generation-v1";

export async function publishGenerationOutbox(boss, client) {
  await client.query("begin");
  try {
    // A delayed publisher must not wake work that already settled or cancelled.
    // Leave historical events unacknowledged rather than invent queue delivery.
    const result = await client.query("select * from makeborne_private.lock_next_generation_outbox()");
    const event = result.rows[0];
    if (!event) {await client.query("commit"); return null;}
    const db = {executeSql: (text, values) => client.query(text, values)};
    const payload = {jobId: event.job_id, workspaceId: event.workspace_id, eventId: event.id};
    const id = await boss.send(GENERATION_QUEUE, payload, {id: event.id, db, retryLimit: 3, expireInSeconds: 120});
    if (id !== event.id) {
      const prior = await boss.getJobById(GENERATION_QUEUE, event.id, {db});
      if (!prior || prior.data?.jobId !== event.job_id || prior.data?.workspaceId !== event.workspace_id || prior.data?.eventId !== event.id) {
        throw new Error("OUTBOX_QUEUE_IDENTITY_UNCONFIRMED");
      }
    }
    await client.query("select makeborne_private.ack_generation_job_outbox($1::uuid,$2::uuid)", [event.id, event.id]);
    await client.query("commit");
    return {eventId: event.id, jobId: event.job_id};
  } catch (error) {
    try {await client.query("rollback");} catch {throw new Error("OUTBOX_TRANSACTION_UNCONFIRMED", {cause: error});}
    throw error;
  }
}
