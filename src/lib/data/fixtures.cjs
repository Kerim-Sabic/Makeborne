/* eslint-disable @typescript-eslint/no-require-imports -- Shared generated fixtures for the data report harnesses: datasets with independently known answers and an RLS-emulating fake database/storage. Never used by application code. */
const { createHash, randomUUID } = require("node:crypto");
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const csv = rows => Buffer.from(rows.map(row => row.map(value => /[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value)).join(",")).join("\n"), "utf8");
/** Canonical decimal text, written independently of the library under test. */
const decimal = { canonical: text => { const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text); const frac = (m[3] || "").replace(/0+$/, ""); const whole = m[2].replace(/^0+(?=\d)/, ""); const out = frac ? `${whole}.${frac}` : whole; return out === "0" ? "0" : `${m[1] || ""}${out}`; } };
// ---- Generated datasets with independently known answers (integer cents, BigInt; no shared code with the library) ----
function seeded(seed) { let state = seed >>> 0; return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; }; }
const CATEGORIES = ["Bread", "Pastry", "Coffee", "Cakes", "Sandwiches", "Juice", "Catering"];
function salesRows(count = 240, seed = 7) {
  const random = seeded(seed), rows = [];
  for (let index = 0; index < count; index++) {
    const month = 1 + Math.floor(index / (count / 6));
    rows.push({ date: `2026-${String(month).padStart(2, "0")}-${String(1 + Math.floor(random() * 28)).padStart(2, "0")}`, cents: 100 + Math.floor(random() * 250000), category: CATEGORIES[Math.floor(random() * CATEGORIES.length)] });
  }
  return rows;
}
const centsText = cents => { const v = BigInt(cents), neg = v < 0n, a = neg ? -v : v; return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`; };
const canonical = decimal.canonical;
const sumCents = list => list.reduce((sum, value) => sum + BigInt(value), 0n);
/** (a − b) / |b| × 100 to one decimal, half away from zero, in BigInt. */
function pctChange(a, b) { const num = (BigInt(a) - BigInt(b)) * 1000n, den = BigInt(b) < 0n ? -BigInt(b) : BigInt(b); const q = num / den, r = num % den; const rounded = (r < 0n ? -r : r) * 2n >= den ? q + (num < 0n ? -1n : 1n) : q; return canonical(`${rounded < 0n ? "-" : ""}${(rounded < 0n ? -rounded : rounded) / 10n}.${(rounded < 0n ? -rounded : rounded) % 10n}`); }

// ---- RLS-emulating fake database + storage (members read; owners/editors write; other workspaces invisible) ----
const OWNER = randomUUID(), EDITOR = randomUUID(), REVIEWER = randomUUID(), OUTSIDER = randomUUID();
const W1 = randomUUID(), W2 = randomUUID(), P1 = randomUUID(), P2 = randomUUID();
const STYLE = { id: "editorial", name: "Editorial", version: 1, typography: { headingFont: "Georgia", bodyFont: "Inter" }, colors: { ink: "#111111" }, description: "", referenceAssetIds: [] };
function makeCloud() {
  const now = () => new Date().toISOString();
  const state = { tables: { workspaces: [{ id: W1, name: "Agency", owner_id: OWNER }, { id: W2, name: "Other", owner_id: OUTSIDER }],
    workspace_members: [{ workspace_id: W1, user_id: EDITOR, role: "editor" }, { workspace_id: W1, user_id: REVIEWER, role: "reviewer" }],
    projects: [{ id: P1, workspace_id: W1 }, { id: P2, workspace_id: W2 }], artifacts: [], artifact_versions: [], assets: [] },
    storage: new Map(), allowedTypes: new Set(["image/png", "image/jpeg", "image/webp", "application/pdf", "application/vnd.openxmlformats-officedocument.presentationml.presentation", XLSX, "text/csv", "application/json"]),
    receipts: new Map(), log: [], failSaveAfterCommit: false, now };
  return state;
}
function addArtifact(state, kind, workspace = W1, project = P1, doc = null) {
  const id = randomUUID(), versionId = randomUUID(), t = state.now();
  state.tables.artifacts.push({ id, workspace_id: workspace, project_id: project, kind, title: kind === "book" ? "Monthly report" : "Client report", current_version: 1, created_at: t, updated_at: t });
  state.tables.artifact_versions.push({ id: versionId, workspace_id: workspace, artifact_id: id, version_number: 1, parent_version_id: null, created_at: t, created_by: OWNER, change_summary: "Created",
    content: { schemaVersion: 1, kind, title: kind === "book" ? "Monthly report" : "Client report", sections: [], ...(doc ? { document: doc } : {}) }, style_snapshot: STYLE, asset_manifest: [] });
  return id;
}
function addSource(state, bytes, name, workspace = W1, project = P1) {
  const sha = createHash("sha256").update(bytes).digest("hex"), type = name.endsWith(".csv") ? "text/csv" : XLSX;
  const id = require("../ingest/storage.ts").sourceAssetId({ workspaceId: workspace, projectId: project }, sha);
  const objectPath = `${workspace}/${project}/sources/${sha}.${name.endsWith(".csv") ? "csv" : "xlsx"}`;
  state.storage.set(objectPath, { bytes: Buffer.from(bytes), contentType: type });
  state.tables.assets.push({ id, workspace_id: workspace, project_id: project, object_path: objectPath, content_type: type, sha256: sha, provenance: { kind: "source_upload", name, byteLength: bytes.length }, created_at: state.now() });
  return { assetId: id, sha256: sha };
}
function clientFor(state, user) {
  const workspace = id => state.tables.workspaces.find(row => row.id === id);
  const canRead = id => Boolean(user && workspace(id) && (workspace(id).owner_id === user || state.tables.workspace_members.some(m => m.workspace_id === id && m.user_id === user)));
  const canEdit = id => Boolean(user && workspace(id) && (workspace(id).owner_id === user || state.tables.workspace_members.some(m => m.workspace_id === id && m.user_id === user && m.role === "editor")));
  const scopeOf = (table, row) => table === "workspaces" ? row.id : row.workspace_id;
  const from = table => {
    const filters = []; let order = null, ascending = true, limit = null, insertRow = null;
    const rows = () => {
      let out = state.tables[table].filter(row => table === "workspace_members" ? canRead(row.workspace_id) || row.user_id === user : canRead(scopeOf(table, row))).filter(row => filters.every(test => test(row)));
      if (order) out = [...out].sort((a, b) => (a[order] > b[order] ? 1 : a[order] < b[order] ? -1 : 0) * (ascending ? 1 : -1));
      if (limit) out = out.slice(0, limit);
      return structuredClone(out);
    };
    const builder = {
      select() { return builder; }, eq(key, value) { filters.push(row => (key.startsWith("provenance->>") ? row.provenance?.[key.slice(13)] : row[key]) === value); return builder; }, in(key, values) { filters.push(row => values.includes(row[key])); return builder; },
      gt(key, value) { filters.push(row => row[key] > value); return builder; }, order(key, options) { order = key; ascending = options?.ascending !== false; return builder; }, limit(n) { limit = n; return builder; },
      async maybeSingle() { const out = rows(); return { data: out[0] ?? null, error: null }; },
      insert(row) { insertRow = row; return builder; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (!insertRow) return { data: rows(), error: null };
          if (!canEdit(insertRow.workspace_id)) return { data: null, error: { code: "42501", message: "rls" } };
          if (state.tables[table].some(row => row.id === insertRow.id)) return { data: null, error: { code: "23505", message: "duplicate" } };
          state.tables[table].push({ ...structuredClone(insertRow), created_at: state.now() }); state.log.push({ op: "insert", table, id: insertRow.id });
          return { data: null, error: null };
        }).then(resolve, reject);
      },
    };
    return builder;
  };
  const rpc = async (name, args) => {
    if (name === "makeborne_cloud_schema_version") return { data: "20261003_cloud_v2", error: null };
    if (name !== "makeborne_save_artifact_version") throw new Error(`Unexpected cookie RPC ${name}`);
    state.log.push({ op: "save", args });
    if (!canEdit(args.p_workspace_id)) return { data: null, error: { code: "42501" } };
    const key = `${user}:${args.p_request_key}`, hash = createHash("sha256").update(JSON.stringify(args)).digest("hex");
    const receipt = state.receipts.get(key);
    if (receipt) { if (receipt.hash !== hash) return { data: null, error: { code: "MB409" } }; return { data: { ...receipt.result, replayed: true }, error: null }; }
    const artifact = state.tables.artifacts.find(row => row.id === args.p_artifact_id && row.workspace_id === args.p_workspace_id);
    if (!artifact) return { data: null, error: { code: "P0002" } };
    if (artifact.current_version !== args.p_expected_version) return { data: null, error: { code: "PT409" } };
    for (const id of args.p_asset_ids) if (!state.tables.assets.some(row => row.id === id && row.workspace_id === args.p_workspace_id && row.project_id === artifact.project_id)) return { data: null, error: { code: "23514" } };
    const previous = state.tables.artifact_versions.find(row => row.artifact_id === artifact.id && row.version_number === artifact.current_version);
    const version = { id: randomUUID(), workspace_id: args.p_workspace_id, artifact_id: artifact.id, version_number: artifact.current_version + 1, parent_version_id: previous?.id ?? null,
      content: structuredClone(args.p_content), style_snapshot: args.p_style, asset_manifest: [...args.p_asset_ids], created_at: state.now(), created_by: user, change_summary: args.p_change_summary };
    state.tables.artifact_versions.push(version); artifact.current_version++; artifact.updated_at = state.now();
    const result = { artifact: structuredClone(artifact), version: structuredClone(version) };
    state.receipts.set(key, { hash, result });
    if (state.failSaveAfterCommit) { state.failSaveAfterCommit = false; return { data: null, error: { code: "XX000" } }; }
    return { data: { ...result, replayed: false }, error: null };
  };
  const storage = { from: () => ({ upload: async (objectPath, bytes, options) => {
    if (!canEdit(objectPath.split("/")[0])) return { error: { message: "new row violates row-level security policy" } };
    if (!state.allowedTypes.has(options.contentType)) return { error: { message: `mime type ${options.contentType} is not supported` } };
    if (state.storage.has(objectPath)) return { error: { message: "The resource already exists" } };
    state.storage.set(objectPath, { bytes: Buffer.from(bytes), contentType: options.contentType }); state.log.push({ op: "upload", path: objectPath, contentType: options.contentType });
    return { error: null };
  } }) };
  return { from, rpc, storage, auth: { getUser: async () => ({ data: { user: user ? { id: user, user_metadata: {} } : null }, error: null }) } };
}
// Fixtures used across checks.
const SALES = salesRows();
const SALES_CSV = csv([["Date", "Revenue (EUR)", "Product"], ...SALES.map(row => [row.date, centsText(row.cents), row.category])]);
const SURVEY = (() => {
  const random = seeded(11), answers = ["Very satisfied", "Satisfied", "Neutral", "Unsatisfied"], plans = ["Basic", "Pro", "Team", "Enterprise"], rows = [];
  for (let index = 0; index < 120; index++) rows.push({ satisfaction: index % 17 === 5 ? "" : answers[Math.floor(random() * 4)], rating: index % 23 === 3 ? "n/a" : String(Math.floor(random() * 11)), plan: plans[Math.floor(random() * plans.length)], comment: `Comment ${index}` });
  return rows;
})();
const SURVEY_CSV = csv([["Respondent", "How satisfied are you?", "How likely are you to recommend us?", "Plan", "Anything else?"], ...SURVEY.map((row, index) => [index + 1, row.satisfaction, row.rating, row.plan, row.comment])]);
const CAMPAIGNS = (() => {
  const random = seeded(5), names = ["Search brand", "Search generic", "Social prospecting", "Social retargeting", "Display", "Video", "Email"], rows = [];
  for (let index = 0; index < 84; index++) {
    const spend = 500 + Math.floor(random() * 90000), impressions = 1000 + Math.floor(random() * 200000), clicks = Math.floor(impressions * (0.005 + random() * 0.05));
    rows.push({ campaign: names[index % names.length], month: 1 + (index % 6), spend, impressions, clicks, conversions: Math.floor(clicks * random() * 0.08), revenue: spend * 2 + Math.floor(random() * 50000) });
  }
  return rows;
})();
const CAMPAIGN_CSV = csv([["Campaign", "Date", "Spend (USD)", "Impressions", "Clicks", "Conversions", "Revenue (USD)"], ...CAMPAIGNS.map(row => [row.campaign, `2026-${String(row.month).padStart(2, "0")}-15`, centsText(row.spend), row.impressions, row.clicks, row.conversions, centsText(row.revenue)])]);
const CATALOGUE_CSV = csv([["Product", "Price", "Weight (kg)", "Battery (h)", "Colour"],
  ["Model A", "€199.00", "1.20", "8", "Black"], ["Model B", "€249.50", "1.05", "11.5", "Silver"], ["Model C", "€149.99", "1.40", "6", "Black"], ["Model D", "€329.00", "0.95", "n/a", "Blue"], ["Model E", "€249.50", "1.10", "10", ""]]);


module.exports = { XLSX, csv, seeded, CATEGORIES, salesRows, centsText, canonical, sumCents, pctChange, OWNER, EDITOR, REVIEWER, OUTSIDER, W1, W2, P1, P2, STYLE, makeCloud, addArtifact, addSource, clientFor,
  SALES, SALES_CSV, SURVEY, SURVEY_CSV, CAMPAIGNS, CAMPAIGN_CSV, CATALOGUE_CSV };
