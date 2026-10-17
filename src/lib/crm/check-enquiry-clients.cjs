/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks: website enquiries become CRM leads safely and idempotently. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { derivedUuid, enquiryRequestKey, enquiryActivityId, enquiryClientFields, enquiryOutreach, clientsByEmail, normalEmail } = require("./enquiry-clients.ts");
const { CreateClientSchema } = require("../domain.ts");
const { ClientOutreachSchema, emptyOutreach } = require("../client-outreach.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const enquiry = { id: "8b6a3d0e-1f2c-4c5d-9e8f-0a1b2c3d4e5f", name: "  Ana   Horvat ", email: "Ana@Example.COM ", message: "Hello!\nDo you cater weddings for 80 guests?", created_at: "2026-10-12T09:30:00.000Z" };

check("request keys and activity ids are stable, distinct and valid UUIDs", () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(enquiryRequestKey(enquiry.id), uuid); assert.match(enquiryActivityId(enquiry.id), uuid);
  assert.equal(enquiryRequestKey(enquiry.id), enquiryRequestKey(enquiry.id), "a retry reuses the key");
  assert.notEqual(enquiryRequestKey(enquiry.id), enquiryActivityId(enquiry.id));
  assert.notEqual(enquiryRequestKey(enquiry.id), enquiryRequestKey("8b6a3d0e-1f2c-4c5d-9e8f-0a1b2c3d4e60"));
  assert.notEqual(derivedUuid("a", "bc"), derivedUuid("ab", "c"), "namespace and value are separated");
});

check("client fields fit the CRM's own create schema", () => {
  const fields = enquiryClientFields(enquiry, "Saffron Table");
  assert.deepEqual(CreateClientSchema.strict().parse(fields), fields);
  assert.equal(fields.name, "Ana Horvat"); assert.equal(fields.email, "ana@example.com");
  assert.equal(fields.notes, "Website enquiry via Saffron Table on 2026-10-12:\n\nHello!\nDo you cater weddings for 80 guests?");
  const long = enquiryClientFields({ ...enquiry, name: "x".repeat(300), message: "y".repeat(5000) }, "z".repeat(300));
  assert.ok(CreateClientSchema.strict().safeParse(long).success, "oversized values are clipped to the schema");
  assert.equal(enquiryClientFields({ ...enquiry, name: "   " }, "Site").name, "ana@example.com", "a blank name falls back to the email");
});

check("a new lead gets channel Email, a follow-up today and the enquiry as one note", () => {
  const outreach = enquiryOutreach(enquiry, "Saffron Table", "2026-10-14");
  assert.deepEqual(ClientOutreachSchema.parse(outreach), outreach);
  assert.equal(outreach.stage, "Lead"); assert.equal(outreach.channel, "Email"); assert.equal(outreach.nextFollowUp, "2026-10-14");
  assert.equal(outreach.activity.length, 1);
  assert.equal(outreach.activity[0].id, enquiryActivityId(enquiry.id));
  assert.equal(outreach.activity[0].text, "Website enquiry via Saffron Table: “Hello! Do you cater weddings for 80 guests?”");
  assert.deepEqual(enquiryOutreach(enquiry, "Saffron Table", "2026-10-14", outreach), outreach, "applying the same enquiry twice adds nothing");
});

check("existing clients keep their stage and earlier follow-ups; closed clients keep theirs", () => {
  const existing = { ...emptyOutreach(), stage: "Proposal", channel: "Phone", nextFollowUp: "2026-10-13", activity: [] };
  const updated = enquiryOutreach(enquiry, "Site", "2026-10-14", existing);
  assert.equal(updated.stage, "Proposal"); assert.equal(updated.channel, "Phone"); assert.equal(updated.nextFollowUp, "2026-10-13", "an earlier follow-up stays");
  assert.equal(enquiryOutreach(enquiry, "Site", "2026-10-14", { ...existing, nextFollowUp: "2026-11-01" }).nextFollowUp, "2026-10-14", "a later follow-up moves up to today");
  assert.equal(enquiryOutreach(enquiry, "Site", "2026-10-14", { ...existing, stage: "Won", nextFollowUp: null }).nextFollowUp, null, "won clients get a note, not a follow-up");
  const full = { ...existing, activity: Array.from({ length: 300 }, (_, index) => ({ id: derivedUuid("t", String(index)), at: "2026-10-01T00:00:00.000Z", text: "x", type: "note" })) };
  assert.equal(enquiryOutreach(enquiry, "Site", "2026-10-14", full).activity.length, 300, "the 300-entry history cap is respected");
});

check("email matching ignores case and spaces; first client wins", () => {
  const map = clientsByEmail([{ id: "a", email: " Ana@Example.com" }, { id: "b", email: "ana@example.com" }, { id: "c", email: "" }, { id: "d", email: null }]);
  assert.equal(map.get(normalEmail("ANA@example.com ")), "a"); assert.equal(map.size, 1);
});

check("routes keep the CRM protocol, owner-only access and the normal create path", () => {
  const route = fs.readFileSync(path.join(src, "app", "api", "cloud", "workspaces", "[workspaceId]", "enquiries", "clients", "route.ts"), "utf8");
  const order = ["speaksCurrentCrmProtocol(request.headers)", "cloudBody(request, Body)", "cloudContext(workspaceId, true)", "role !== \"owner\"", "makeborne_create_record", "p_request_key: enquiryRequestKey(enquiry.id)", "p_operation: \"create_client\"", ".eq(\"updated_at\", row.updated_at)"];
  let at = -1;
  for (const marker of order) { const next = route.indexOf(marker, at + 1); assert.ok(next > at, `${marker} out of order`); at = next; }
  assert.match(route, /ids: z\.array\(z\.string\(\)\.uuid\(\)\)\.min\(1\)\.max\(25\)/);
  assert.doesNotMatch(route, /billingDatabase\(\)\.from\("clients"\)/, "clients are never written with the service role");
  const list = fs.readFileSync(path.join(src, "app", "api", "cloud", "workspaces", "[workspaceId]", "enquiries", "route.ts"), "utf8");
  assert.match(list, /role !== "owner"\) return cloudJson\(\{ items: \[\] \}\)/, "non-owners see no enquiries");
  const client = fs.readFileSync(path.join(src, "components", "enquiry-leads.tsx"), "utf8");
  assert.match(client, /\.\.\.crmProtocolHeaders/, "the browser sends the CRM protocol header");
});

console.log(`\n${passed} enquiry-to-client checks passed.`);
