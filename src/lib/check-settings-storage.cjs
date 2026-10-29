/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks: every Settings item says where it is stored, and that label matches the code path that stores it; customer copy uses the product's terms, not internal ones ("cloud studio", "cloud draft"). No network. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(src, file), "utf8");
const loadTs = file => {
  const compiled = { exports: {} };
  new Function("require", "module", "exports", ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(require, compiled, compiled.exports);
  return compiled.exports;
};
const { STORAGE_LABEL, SETTINGS_STORAGE } = loadTs("lib/settings-storage.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const studio = read("components/studio.tsx");
const settingsStart = studio.indexOf(`{tab === "settings" && (`);
const settings = studio.slice(settingsStart, studio.indexOf("{creationView}", settingsStart));

check("labels are the two agreed phrases", () => {
  assert.deepEqual({ ...STORAGE_LABEL }, { device: "This device", account: "Saved to your account" });
  assert.match(read("components/storage-label.tsx"), /STORAGE_LABEL\[where\]/);
});

check("every Settings section carries exactly one storage label, from the registry", () => {
  const headings = [...settings.matchAll(/<h2>([^<]+)<StorageLabel where=\{SETTINGS_STORAGE\.(\w+)\} \/><\/h2>/g)].map(match => [match[1].trim(), match[2]]);
  assert.deepEqual(headings, [["Account projects", "accountProjects"], ["Drafts on this device", "deviceWorkspace"], ["Studio sounds", "studioSounds"]]);
  assert.equal((settings.match(/<h2>/g) ?? []).length, headings.length, "no unlabelled section");
  assert.match(settings, /<SiteBadgeSetting \/>/);
  assert.match(read("components/site-badge-setting.tsx"), /<h2>Website badge <StorageLabel where=\{SETTINGS_STORAGE\.websiteBadge\} \/><\/h2>/);
  assert.match(settings, /<AccountDataRights accountId=\{composerAccount\.accountId\} \/>/);
  assert.match(read("components/account-data-rights.tsx"), /<h2>Your data <StorageLabel where=\{SETTINGS_STORAGE\.yourData\} \/><\/h2>/);
  assert.deepEqual(Object.keys(SETTINGS_STORAGE).sort(), ["accountProjects", "deviceWorkspace", "studioSounds", "websiteBadge", "yourData"]);
});

check("each label matches where the code stores that setting", () => {
  const model = read("components/studio-model.ts");
  // Device: the local workspace (projects, clients and the sound choice) is written only to browser storage.
  assert.equal(SETTINGS_STORAGE.deviceWorkspace, "device"); assert.equal(SETTINGS_STORAGE.studioSounds, "device");
  assert.match(model, /export function saveLocalWorkspace\(workspace: Workspace, storage: Pick<Storage, "setItem">\) \{\r?\n\s*LocalWorkspaceSchema\.parse\(workspace\);\r?\n\s*storage\.setItem\(storageKey, JSON\.stringify\(workspace\)\);/);
  assert.match(model.slice(model.indexOf("LocalWorkspaceSchema")), /sound: z\.boolean\(\)/, "the sound choice lives in the local workspace");
  assert.match(settings, /setWorkspace\(\(w\) => \(\{ \.\.\.w, sound: !w\.sound \}\)\)/);
  assert.doesNotMatch(studio, /fetch\([^)]*sound/i, "the sound choice is never sent to the server");
  // Account: the badge is a workspace row on the server, and account projects are saved through the account API.
  assert.equal(SETTINGS_STORAGE.websiteBadge, "account"); assert.equal(SETTINGS_STORAGE.accountProjects, "account");
  assert.match(read("components/site-badge-setting.tsx"), /fetch\("\/api\/workspaces\/branding", \{\r?\n?\s*method: "PUT"/);
  assert.match(read("app/api/workspaces/branding/route.ts"), /from\("workspaces"\)\.update\(\{ site_badge: body\.showBadge \}\)/);
  // Your data: requests and their status live on the server, per account.
  assert.equal(SETTINGS_STORAGE.yourData, "account");
  assert.match(read("components/account-data-rights.tsx"), /fetch\("\/api\/account\/data"/);
});

check("Settings no longer contradicts itself", () => {
  for (const stale of [/does not sync to the cloud/i, /This preview stores projects/i, /<h2>Account storage<\/h2>/, /<h2>Workspace storage<\/h2>/, /during this transition/i, /Keep your local work safe/i])
    assert.doesNotMatch(settings, stale);
  assert.match(settings, /are not saved to your\s+account or other devices/);
  assert.match(settings, /saved to your\s+account and save automatically as you edit/);
});

check("customer copy uses product terms, not internal cloud vocabulary", () => {
  const files = ["components/cloud-studio.tsx", "components/cloud-api.ts", "lib/cloud/server.ts", "lib/cloud/config.ts", "app/studio/cloud/page.tsx", "components/studio.tsx", "app/api/export/route.ts", "app/admin/system.tsx"];
  const internal = /\b(cloud (studio|draft|workspace|projects?|content|versions?|records|setup|storage|database|access|request|response|operation|import|artwork|asset|brief|work|services|worker|availability))\b|\bthe cloud\b|Local studio/i;
  for (const file of files) {
    const lines = read(file).split(/\r?\n/).filter(line => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line));
    // Strings and JSX text only: drop paths, identifiers and class names before matching.
    const visible = lines.map(line => line.replace(/\/api\/cloud\/[^\s"'`]*/g, "").replace(/className="[^"]*"/g, "").replace(/makeborne[.-]cloud[\w.-]*/g, ""));
    const hits = visible.filter(line => internal.test(line));
    // The admin console may name its configuration; it only links to the customer page by its customer title.
    if (file === "app/admin/system.tsx") assert.ok(!hits.some(line => /Cloud studio/.test(line)), `${file}: ${hits.join(" | ")}`);
    else assert.deepEqual(hits, [], file);
  }
  assert.match(read("app/studio/cloud/page.tsx"), /title: "Saved account records"/);
  assert.match(read("components/cloud-studio.tsx"), /"Leave this unsaved draft\?/);
});

console.log(`${passed}/5 settings storage and wording checks passed.`);
