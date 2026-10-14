/* eslint-disable @typescript-eslint/no-require-imports -- Offline CRM tool checks: CSV import/export and one-click follow-up changes. */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
const src = require("node:path").join(__dirname, "..");
Module._load = function(name, parent, main) {
  if (/(^|\/)cloud-api$/.test(name)) return { api: async () => { throw new Error("network not available offline"); } };
  // The app's "@/..." alias points at src/.
  if (name.startsWith("@/")) return load.call(this, require("node:path").join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const { toCsv, parseCsv, mapImport, MAX_IMPORT_ROWS } = require("./client-csv.ts");
const { applyQuickChange, addDays, nextMonday } = require("../components/client-quick-actions.ts");
const { ClientOutreachSchema } = require("./client-outreach.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }

check("export escapes quotes, commas and newlines, keeps accents, and neutralises spreadsheet formulas", () => {
  const csv = toCsv(["Name", "Notes"], [["Ana Kovač", 'Said "yes", then\nleft'], ["=HYPERLINK(\"x\")", "+1 555"], ["@cmd", "-2"]]);
  assert.ok(csv.startsWith("﻿Name,Notes\r\n"));
  assert.match(csv, /Ana Kovač,"Said ""yes"", then\nleft"/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)",'\+1 555/);
  assert.match(csv, /'@cmd,'-2/);
  assert.deepEqual(parseCsv(csv).slice(1, 2), [["Ana Kovač", 'Said "yes", then\nleft']], "round trip");
});

check("import maps common headers (including first/last name and semicolon files) and validates rows", () => {
  const result = mapImport(parseCsv("Full Name,Organisation,E-mail,Web,Comments\nAna Kovač,Studio Aurora,ANA@EXAMPLE.TEST,example.test,Met at fair\n,No name,x@y.z,,\nMarko,,bad-email,,\nAna Kovač,Studio Aurora,ana@example.test,,dup\n"));
  assert.deepEqual(result.clients, [{ name: "Ana Kovač", company: "Studio Aurora", email: "ana@example.test", website: "https://example.test", notes: "Met at fair", profileUrl: "", tags: [] }]);
  assert.deepEqual(result.skipped.map(item => [item.row, item.reason.split(" ")[0]]), [[3, "No"], [4, "Invalid"], [5, "Duplicate"]]);
  const split = mapImport(parseCsv("First name;Last name;Email\nLejla;Hodžić;lejla@example.test\n"));
  assert.equal(split.clients[0].name, "Lejla Hodžić");
  assert.equal(split.columns.name, "First name + Last name");
  assert.match(mapImport(parseCsv("Email\na@b.co\n")).skipped[0].reason, /No name or Instagram\/profile column/);
  // Creator lists: handles become profile links, the handle stands in for a missing name, tags split on ; | ,
  const creators = mapImport(parseCsv("Instagram,Tags\n@maya.plants,creator; plants\nhttps://www.instagram.com/natgeo/,brand\n"));
  assert.deepEqual(creators.clients.map(item => [item.name, item.profileUrl, item.tags]), [["maya.plants", "https://www.instagram.com/maya.plants/", ["creator", "plants"]], ["natgeo", "https://www.instagram.com/natgeo/", ["brand"]]]);
  assert.equal(mapImport(parseCsv("Name,TikTok\nKhaby,@khaby.lame\n")).clients[0].profileUrl, "https://www.tiktok.com/@khaby.lame");
  assert.equal(mapImport(parseCsv("Name,Instagram\nBad,not a handle!\n")).clients[0].profileUrl, "", "invalid handles are dropped, not linked");
  const many = mapImport(parseCsv(`Name\n${Array.from({ length: MAX_IMPORT_ROWS + 3 }, (_, i) => `Client ${i}`).join("\n")}\n`));
  assert.equal(many.clients.length, MAX_IMPORT_ROWS);
  assert.equal(many.skipped.length, 3);
});

check("one-click follow-ups record history and keep the outreach valid", () => {
  const today = "2026-10-13";
  const base = { stage: "Lead", channel: "Email", profileUrl: "", lastContact: null, nextFollowUp: "2026-10-10", notes: "", activity: [] };
  const contacted = applyQuickChange(base, { kind: "contacted", nextFollowUp: addDays(today, 3), note: "Sent: hello" }, today);
  assert.equal(contacted.stage, "Contacted", "a new lead moves to Contacted");
  assert.equal(contacted.lastContact, today);
  assert.equal(contacted.nextFollowUp, "2026-10-16");
  assert.equal(contacted.activity.at(-1).type, "contact");
  assert.match(contacted.activity.at(-1).text, /^Sent: hello\n\nNext follow-up 2026-10-16$/);
  ClientOutreachSchema.parse(contacted);
  const snoozed = applyQuickChange(contacted, { kind: "snooze", nextFollowUp: nextMonday(today) }, today);
  assert.equal(snoozed.nextFollowUp, "2026-10-19");
  assert.equal(snoozed.activity.length, 2);
  const won = applyQuickChange(snoozed, { kind: "stage", stage: "Won" }, today);
  assert.equal(won.stage, "Won");
  assert.match(won.activity.at(-1).text, /Stage: Contacted → Won/);
  assert.equal(applyQuickChange(undefined, { kind: "stage", stage: "Proposal" }, today).activity.length, 1, "works with no previous outreach");
});

check("calendar helpers handle month ends and Mondays", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-12-31", 14), "2027-01-14");
  assert.equal(nextMonday("2026-10-12"), "2026-10-19", "a Monday moves a full week");
  assert.equal(nextMonday("2026-10-18"), "2026-10-19");
});

check("lead scores are transparent, bounded and skip closed clients; follower counts parse", () => {
  const { scoreLead, countValue, emptyLead, normalizeTag, leadFromRow } = require("./leads.ts");
  assert.deepEqual(["48K", "1.2M", "1,204", "812", "2,5K", "", null, "lots"].map(countValue), [48000, 1200000, 1204, 812, 2500, null, null, null]);
  const rich = { ...emptyLead(), dealValue: 1500, profile: { research: { url: "", platform: "Instagram", handle: "x", followers: "48K", following: null, posts: null, bio: "", at: "" }, insight: { niche: "Fitness", audience: "", angle: "", confidence: "high", at: "" } } };
  const hot = scoreLead({ stage: "Proposal", hasEmail: true, lead: rich, overdue: false });
  assert.equal(hot.tier, "hot"); assert.ok(hot.value <= 100); assert.ok(hot.reasons.includes("48K followers") && hot.reasons.includes("deal value set"));
  const cold = scoreLead({ stage: "Lead", hasEmail: false, lead: emptyLead(), overdue: true });
  assert.deepEqual([cold.value, cold.tier], [10, "cold"]); assert.ok(cold.reasons.includes("no email") && cold.reasons.includes("follow-up overdue"));
  assert.equal(scoreLead({ stage: "Won", hasEmail: true, lead: rich, overdue: false }), null);
  assert.equal(normalizeTag("  Sarajevo   creators <b> "), "Sarajevo creators b");
  assert.deepEqual(leadFromRow({ tags: null, deal_value: "1500.50", deal_currency: null, lead_source: null, lead_profile: { research: { bad: true } } }).profile, {}, "invalid stored profiles are ignored");
});

console.log(`${passed} CRM tool checks passed (CSV export safety, import mapping and validation, quick follow-ups, dates).`);
