import {PgBoss} from "pg-boss";

const roles = new Set(["makeborne_generation_worker", "makeborne_generation_publisher", "makeborne_project_builder"]);
export async function assertGenerationRole(pool, role) {
  if (!roles.has(role)) throw new Error("INVALID_GENERATION_ROLE");
  const result = await pool.query(`select current_user as name,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolcanlogin,
    s.rolsuper or s.rolcreatedb or s.rolcreaterole or s.rolreplication or s.rolbypassrls as privileged_login,
    exists(select 1 from pg_catalog.pg_roles x where x.rolname not in (current_user,session_user)
      and (pg_catalog.pg_has_role(session_user,x.oid,'MEMBER') or pg_catalog.pg_has_role(current_user,x.oid,'MEMBER'))) as extra_memberships
    from pg_catalog.pg_roles r join pg_catalog.pg_roles s on s.rolname=session_user where r.rolname=current_user`);
  const row = result.rows[0];
  if (row?.name !== role || [row.rolsuper,row.rolcreatedb,row.rolcreaterole,row.rolreplication,row.rolbypassrls,row.rolcanlogin,row.privileged_login,row.extra_memberships].some(Boolean)) {
    throw new Error("RESTRICTED_GENERATION_ROLE_REQUIRED");
  }
}

/** Operator creates/upgrades the dedicated queue schema first. Runtime never
 * receives DDL, queue-policy mutation, account or migration privileges. */
export async function createGenerationQueueRuntime({pool, schema, role, report = () => {}}) {
  if (role === "makeborne_project_builder") throw new Error("INVALID_GENERATION_QUEUE_ROLE");
  if (typeof schema !== "string" || !/^makeborne_queue(?:_probe_[a-f0-9]{12})?$/.test(schema)) throw new Error("INVALID_GENERATION_QUEUE_SCHEMA");
  await assertGenerationRole(pool, role);
  const boss = new PgBoss({schema, db: {executeSql: (text, values) => pool.query(text, values)},
    migrate: false, createSchema: false, supervise: false, schedule: false, registerInstance: false,
    notify: false, reindex: false, monitorVacuum: false});
  // pg-boss can include SQL/configuration in its errors. Export a fixed code,
  // never the raw event, provider data or connection object.
  boss.on("error", () => report({code: "GENERATION_QUEUE_RUNTIME_ERROR"}));
  try {await boss.start(); return boss;}
  catch {await boss.stop({graceful: false}).catch(() => {}); throw new Error("GENERATION_QUEUE_START_UNCONFIRMED");}
}
