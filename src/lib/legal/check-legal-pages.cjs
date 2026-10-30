/* eslint-disable @typescript-eslint/no-require-imports -- Offline legal pages check: documents, required sections, links, footers, sign-up line and checkout consent. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
const root = path.join(__dirname, "..", "..", "..");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { parseMarkdown, plainText } = require("./markdown.ts");
const { LEGAL_DOCUMENTS, LEGAL_VERSION, LEGAL_UPDATED, PRIVACY_VERSION, PRIVACY_UPDATED, WITHDRAWAL_CONSENT_TEXT, WITHDRAWAL_CONSENT_VERSION, SIGNUP_TERMS_LINE } = require("./versions.ts");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const docs = Object.fromEntries(LEGAL_DOCUMENTS.map(doc => [doc.file, parseMarkdown(read(`docs/legal/${doc.file}`))]));
const text = file => plainText(docs[file]);
const ROUTES = new Set([...LEGAL_DOCUMENTS.map(doc => doc.path), "/billing/terms", "/withdraw", "/billing", "/help"]);

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }

check("every legal document has one title, the current version and date, and no placeholders or preview wording", () => {
  for (const doc of LEGAL_DOCUMENTS) {
    const blocks = docs[doc.file];
    assert.equal(blocks.filter(block => block.kind === "heading" && block.level === 1).length, 1, doc.file);
    assert.equal(blocks[0].kind === "heading" && blocks[0].text, doc.title, doc.file);
    assert.match(text(doc.file), new RegExp(`Last updated ${doc.file === "privacy.md" ? PRIVACY_UPDATED : LEGAL_UPDATED} · Version ${doc.file === "privacy.md" ? PRIVACY_VERSION : LEGAL_VERSION}`), doc.file);
    assert.doesNotMatch(read(`docs/legal/${doc.file}`), /\{\{|TODO|\bpreview notice\b|current Makeborne preview/i, doc.file);
  }
});

check("controller identity and contact are on every document", () => {
  for (const doc of LEGAL_DOCUMENTS) {
    const body = text(doc.file);
    assert.match(body, /ZORBY&CO d\.o\.o\./, doc.file);
    assert.match(body, /Vilsonovo šetalište 10, 71000 Sarajevo/, doc.file);
    if (doc.file !== "dpa.md") assert.match(body, /admin@makeborne\.com/, doc.file);
  }
  assert.match(text("imprint.md"), /4203428970007/);
  assert.match(text("privacy.md"), /4203428970007/);
});

check("Terms carry acceptable use, ownership, AI, withdrawal with the model form, liability, sanctions and governing law", () => {
  const body = text("terms.md");
  for (const needle of [/Acceptable use/, /You own your content and the output/, /No AI training/, /withdraw from a purchase within 14 days/, /Model withdrawal form/, /I hereby give notice that I withdraw/, /fees you paid us in the 12 months/, /gross negligence/, /death or personal injury/, /sanctions/, /law of Bosnia and Herzegovina/, /courts in Sarajevo/, /mandatory laws of the country where you live/, /online dispute resolution platform closed on 20 July 2025/, /at least 18/, /30 days' notice/, /Whop/])
    assert.match(body, needle);
  assert.match(body, new RegExp(SIGNUP_TERMS_LINE.before + SIGNUP_TERMS_LINE.terms + SIGNUP_TERMS_LINE.middle + SIGNUP_TERMS_LINE.privacy));
});

check("Privacy Policy has purposes with legal bases and retention, recipients, transfers, rights, authorities, cookies, children and the lead finder", () => {
  const body = text("privacy.md");
  const tables = docs["privacy.md"].filter(block => block.kind === "table");
  assert.ok(tables.length >= 3);
  const heads = tables.map(table => table.head.map(cell => cell.map(part => part.text).join("")).join("|"));
  assert.ok(heads.includes("Purpose|Data|Legal basis|Kept"), heads.join(" / "));
  for (const provider of ["Supabase", "Vercel", "Cloudflare", "DigitalOcean", "Anthropic", "OpenAI", "Resend", "Whop", "Google", "GitHub", "OpenStreetMap"]) assert.match(body, new RegExp(provider), provider);
  for (const right of [/access/, /portability/, /correction/, /deletion/, /restrict/, /object/, /withdraw consent/, /complain to a supervisory authority/, /Personal Data Protection Agency/, /ICO/, /ANPD/, /do not sell or share/]) assert.match(body, right);
  for (const needle of [/EU representative \(GDPR Art\. 27\): to be appointed/, /data protection officer/, /no EU adequacy decision/, /Standard Contractual Clauses/, /aged 18 or over/, /Lead finder/, /customer, who is the controller/, /no consent banner is required/i, /Limited Use/]) assert.match(body, needle);
});

check("DPA has Art. 28 duties, breach notice, sub-processors with objection, SCC module 2 and three annexes", () => {
  const body = text("dpa.md");
  for (const needle of [/Annex I/, /Annex II/, /Annex III/, /Module 2 \(controller to processor\)/, /UK Addendum/, /48 hours/, /general authorisation/, /30 days in advance/, /object/, /audits/, /delete the data/, /Certifications/, /None held/, /Row-level security/, /AES-256-GCM/]) assert.match(body, needle);
});

check("every internal link in the documents points at a real page", () => {
  for (const doc of LEGAL_DOCUMENTS) for (const block of docs[doc.file]) {
    const parts = block.kind === "paragraph" ? block.inline : block.kind === "list" ? block.items.flat() : block.kind === "table" ? [...block.head, ...block.rows.flat()].flat() : [];
    for (const part of parts) if (part.kind === "link" && part.href.startsWith("/")) assert.ok(ROUTES.has(part.href.split("#")[0]), `${doc.file} → ${part.href}`);
  }
  for (const route of [...ROUTES].filter(route => route !== "/")) assert.ok(fs.existsSync(path.join(root, "src/app", route, "page.tsx")), route);
  for (const doc of LEGAL_DOCUMENTS) assert.match(read(`src/app${doc.path}/page.tsx`), new RegExp(`LEGAL_DOCUMENTS\\[${LEGAL_DOCUMENTS.indexOf(doc)}\\]`), doc.path);
});

check("the legal pages are in the sitemap and linked from every public footer and the account settings", () => {
  const metadata = read("src/lib/site-metadata.ts");
  for (const route of [...LEGAL_DOCUMENTS.map(doc => doc.path), "/withdraw"]) assert.match(metadata, new RegExp(`"${route}"`), route);
  for (const file of ["src/app/help/help-chrome.tsx", "src/components/account-form.tsx", "src/components/creation-home.tsx", "src/components/billing-workspace.tsx", "src/app/billing/terms/page.tsx", "src/components/studio.tsx", "src/app/auth/verify/email-confirmation.tsx", "src/app/auth/update-password/update-password-form.tsx"])
    assert.match(read(file), /<LegalLinks \/>/, file);
  assert.match(read("src/components/studio.tsx"), /className="settings-legal"/);
  assert.match(read("src/components/portal/portal-shell.tsx"), /href="\/terms"[\s\S]*href="\/privacy"/);
});

check("sign-up shows the clickwrap line as links and stores the accepted version", () => {
  const form = read("src/components/account-form.tsx");
  assert.match(form, /\{mode === "signup" && <TermsLine \/>\}/);
  assert.match(form, /data: \{ terms_version: LEGAL_VERSION, terms_accepted_at: new Date\(\)\.toISOString\(\) \}/);
  assert.match(form, /<Link href="\/terms">\{SIGNUP_TERMS_LINE\.terms\}<\/Link>/);
  assert.doesNotMatch(form, /type="checkbox"[^>]*defaultChecked|checked=\{true\}/);
});

check("checkout asks for the unticked immediate-start request before Whop and records its version", () => {
  const plans = read("src/components/creation-plans.tsx"), route = read("src/app/api/billing/checkout/route.ts"), lines = read("docs/legal/checkout-and-signup-lines.md");
  assert.match(plans, /const \[consented, setConsented\] = useState\(false\)/);
  assert.match(plans, /withdrawalConsent: WITHDRAWAL_CONSENT_VERSION/);
  assert.match(plans, /if \(consentMissing\(\)\) return;[\s\S]*if \(consentMissing\(\)\) return;/);
  assert.match(plans, /aria-disabled=\{gated\}/);
  assert.match(route, /makeborne_withdrawal_consent: WITHDRAWAL_CONSENT_VERSION/);
  assert.equal(WITHDRAWAL_CONSENT_VERSION, `withdrawal-${LEGAL_VERSION}`);
  const quoted = lines.replace(/’/g, "'");
  assert.ok(quoted.includes(`> ${WITHDRAWAL_CONSENT_TEXT.replace(/’/g, "'")}`), "the documented consent text matches the app");
  // Art. 11a: "Withdraw from contract here" opens the notice; "Confirm withdrawal" sends it (no mailto-only step).
  assert.match(read("src/app/withdraw/page.tsx"), /<WithdrawForm /);
  const form = read("src/components/legal/withdraw-form.tsx");
  assert.match(form, /Withdraw from contract here/); assert.match(form, /Confirm withdrawal/); assert.match(form, /\/api\/legal\/withdraw/);
  assert.doesNotMatch(read("src/app/withdraw/page.tsx"), /mailto:/);
});

check("the Markdown subset parses tables, lists, bold and safe links only", () => {
  const blocks = parseMarkdown("# T\n\nA **b** [c](/terms) [x](javascript:void)\n\n- one\n- two\n\n| h | i |\n|---|---|\n| 1 | 2 |\n");
  assert.deepEqual(blocks.map(block => block.kind), ["heading", "paragraph", "list", "table"]);
  assert.deepEqual(blocks[1].inline.map(part => part.kind), ["text", "bold", "text", "link", "text", "text"]);
  assert.equal(blocks[1].inline[5].text, "x");
  assert.equal(blocks[3].rows[0][1][0].text, "2");
});

console.log(`legal pages: ${passed} checks passed`);
