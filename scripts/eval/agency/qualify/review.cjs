/* eslint-disable @typescript-eslint/no-require-imports -- Paid qualification: the fresh-context independent reviewer on rendered fixtures through the real review path and spend gate. */
'use strict';
/*
 * Independent reviewer (cap $5 Anthropic), plan: docs/release-review/independent-review-qualification-20261023.md §1.
 * 12 fixtures (website, book, deck: 2 acceptable + 2 seeded each) rendered in real Chromium, exported to real
 * PDF/PPTX, captured and checked by the REAL capture-server, deterministic checks and assembleRequest, then reviewed
 * by runIndependentReview (kind independent_review) composed as the review route does (inputs = the artifact
 * version, ceiling below, platform deadline 105 s). Each seeded fixture also carries one defect the deterministic
 * checks cannot see (missing brief requirement, illegible text, contradiction, placeholder, misspelt brand).
 * Then 6 targeted re-checks: the scripted correct repair is saved as version 2 and the same reviewer contract,
 * restricted to the first review's repairable findings (recheckText), re-verifies them (reverifyFindings).
 * Approved facts are supplied directly (as the knowledge module would expose them); knowledge stays off.
 */
const c = require('./common.cjs');
const path = require('node:path');

const BRIEF = { id: 'brief-qual', version: 1, approved: true, summary: 'Harbour Bakery: one-page site, a short guide and a three-slide pitch for the weekly bread box.',
  requirements: [
    { id: 'contact', text: 'Visitors can send a message.' },
    { id: 'hours', text: 'Show the opening hours (open daily from seven until two).' },
    { id: 'pickup', text: 'Say that the bread box is collected on Saturdays.' },
    { id: 'brand', text: 'Use the name Harbour Bakery exactly.' },
  ] };
const FACTS = { snapshotId: 'facts-qual-20261024', facts: [
  { id: 'price-box', statement: 'The weekly bread box costs €49 per month.', value: '€49' },
  { id: 'pickup-day', statement: 'The bread box is collected on Saturdays.', value: 'Saturdays' },
  { id: 'address', statement: 'Harbour Bakery is on Pier 4.', value: 'Pier 4' },
  { id: 'order-deadline', statement: 'Bread box orders close on Thursday for Saturday collection.', value: 'Thursday' },
  { id: 'hours', statement: 'Harbour Bakery opens daily from seven until two.', value: 'seven until two' },
  { id: 'team', statement: 'Ana and Luka Marić run Harbour Bakery and bake every morning.' },
  { id: 'boxes-sold', statement: 'Bread boxes sold (shop records): 120 in January, 160 in February, 210 in March.', value: '120, 160, 210' },
  { id: 'free-delivery', statement: 'Free delivery inside the old town walls every Saturday.' },
] };
const DAWN = [
  'The ovens at Harbour Bakery are lit long before the shop opens, while the harbour is still dark.',
  'Sourdough is mixed the evening before and left to rise slowly in the cool back room.',
  'Rye loaves are shaped by hand and baked in the old stone oven, which keeps its heat well.',
  'When the first trays of pastries come out, they cool on the racks by the window.',
  'Ana checks each batch before it goes on the shelves.',
  'Luka looks after the flour orders and the deliveries from the mill.',
  'Regulars know the bakers by name and often stop for a word at the counter.',
  'Whatever is left at closing is set aside for soup the next day.',
  'The bread changes a little with the seasons, darker in winter and lighter in summer.',
  'Customers who bring their own cloth bags are thanked every time.',
  'New bakers start on the pastry bench before they learn the sourdough.',
  'Every recipe is written in one family notebook kept by the oven.',
];

// ---- Website fixtures (same structure as check-review-render.cjs) ----
function site(defects = [], { variant = false } = {}) {
  const has = name => defects.includes(name);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Harbour Bakery</title>
<style>:root{--ink:#1d2433;--accent:#b4441c;--paper:#fbf7f0}*{box-sizing:border-box}body{margin:0;font-family:Georgia,serif;color:var(--ink);background:var(--paper)}
header{display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;padding:16px 24px}header img{width:40px;height:20px;display:block}nav a{margin-right:12px;color:var(--ink)}
section{padding:40px 24px;max-width:1100px;margin:0 auto}h1{font-size:clamp(32px,6vw,64px);margin:0 0 16px}.hero img{max-width:100%;height:auto;display:block}.price{font-size:24px;color:var(--accent)}
.faint{color:#efe9df}form{display:grid;gap:12px;max-width:420px}label{display:grid;gap:4px}input,textarea{font:inherit;padding:8px;border:1px solid #999;width:100%}footer{padding:24px;text-align:center}</style></head><body>
<header><img src="/assets/logo.png" alt="Harbour Bakery logo" class="logo"><nav><a href="#menu">Menu</a>${has('no-hours') ? '' : '<a href="#visit">Visit</a>'}${variant ? '<a href="#team">Team</a>' : ''}</nav></header>
<main>
<section id="hero" class="hero"><h1>${variant ? 'Sourdough from the harbour' : 'Bread baked at dawn'}</h1><p>Sourdough and pastries from Pier 4.</p><img src="/assets/hero.png" alt="Loaves on a wooden shelf" width="800" height="400">${has('overflow') ? '<div class="strip" style="width:600px;height:12px;background:#ccc"></div>' : ''}</section>
<section id="menu"><h2>Menu</h2><p class="price">Weekly bread box: ${has('claim') ? '€59' : '€49'} per month</p>${has('broken') ? '<img src="/assets/missing.png" alt="The bread box">' : ''}${has('clipped') ? '<p class="badge" style="width:140px;overflow:hidden;white-space:nowrap;border:1px solid #999">Free delivery inside the old town walls every Saturday</p>' : ''}<p${has('faint') ? ' class="faint"' : ''}>The bread box is collected on Saturdays. Order by Thursday.</p></section>
${variant ? '<section id="team"><h2>Team</h2><p>Ana and Luka Marić bake every morning.</p></section>' : ''}
${has('no-hours') ? '' : `<section id="visit"><h2>Visit</h2>${has('covered') ? '<div class="hours" style="position:relative"><p>Open daily from seven until two</p><div class="stamp" style="position:absolute;inset:0;background:#b4441c"></div></div>' : '<p>Open daily from seven until two</p>'}</section>`}
<section id="contact"><h2>Write to us</h2><form><label>Name<input name="name" required></label><label>Message<textarea name="message"></textarea></label><button type="submit">Send</button></form></section>
</main>
<footer><p>Harbour Bakery, Pier 4</p></footer>
</body></html>`;
}

function fixtures(emptyDocument) {
  // Distinct paragraphs only (rounds 2-3 recombined sentences, which the reviewer rightly reported as duplicated text).
  const longChapter = count => (process.argv.includes('--recombined') ? Array.from({ length: Math.min(count, DAWN.length * 2) }, (_, i) => i < DAWN.length ? DAWN[i] : `${DAWN[i - DAWN.length]} ${DAWN[(i * 5 + 3) % DAWN.length]}`) : DAWN.slice(0, Math.min(count, DAWN.length))).join('\n\n');
  const book = (chapters, title = 'Harbour Bakery guide') => { const doc = emptyDocument('book', title); doc.chapters = chapters; return doc; };
  const deck = (slides, title = 'Harbour Bakery') => { const doc = emptyDocument('deck', title); doc.slides = slides; return doc; };
  const boxChapter = text => ({ id: 'box', title: 'The bread box', text });
  const goodBox = 'The weekly bread box costs €49 per month and is collected on Saturdays at Pier 4. Harbour Bakery opens daily from seven until two.';
  const slides = (overrides = {}) => [
    { id: 'intro', layout: 'statement', tone: 'light', title: overrides.introTitle ?? 'Harbour Bakery: bread baked at dawn', notes: 'Open with the morning routine.' },
    { id: 'growth', layout: 'chart', tone: 'light', title: 'Boxes sold per month', notes: 'Explain the growth.', chart: { type: 'column', categories: ['Jan', 'Feb', 'Mar'], series: [{ name: 'Boxes', values: [120, 160, 210] }], source: 'Shop records' } },
    { id: 'offer', layout: 'points', tone: 'light', title: 'The weekly box', notes: 'Price and pickup.', points: overrides.points ?? [{ text: '€49 per month' }, { text: 'Collected on Saturdays at Pier 4' }] },
  ];
  return [
    { id: 'web-a1', kind: 'website', seeded: false, html: site() },
    { id: 'web-a2', kind: 'website', seeded: false, html: site([], { variant: true }) },
    { id: 'web-s1', kind: 'website', seeded: true, html: site(['broken', 'clipped', 'no-hours']), repaired: site(),
      reviewerOnly: [{ defect: 'opening hours missing (brief requirement "hours")', match: /hour|opening|seven until two|\bhours\b/i }] },
    { id: 'web-s2', kind: 'website', seeded: true, html: site(['claim', 'covered', 'overflow', 'faint']), repaired: site(),
      reviewerOnly: [{ defect: 'pickup sentence is near-invisible (low contrast #efe9df on #fbf7f0)', match: /contrast|legib|faint|pale|invisible|hard to read|barely|low.?contrast|light text/i }] },
    { id: 'book-a1', kind: 'book', seeded: false, doc: book([{ id: 'dawn', title: 'Dawn bakes', text: longChapter(40) }, boxChapter(goodBox)]) },
    { id: 'book-a2', kind: 'book', seeded: false, doc: book([{ id: 'dawn', title: 'Dawn bakes', text: longChapter(30) }, { id: 'people', title: 'The people', text: 'Ana and Luka Marić run Harbour Bakery on Pier 4 and bake every morning.' }, boxChapter(goodBox)]) },
    { id: 'book-s1', kind: 'book', seeded: true, doc: book([{ id: 'dawn', title: 'Dawn bakes', text: longChapter(40) }, boxChapter('The weekly bread box costs €49 per month and is collected on Sundays at Pier 4. Harbour Bakery opens daily from seven until two.')]),
      exportWithout: 'box', repairedDoc: book([{ id: 'dawn', title: 'Dawn bakes', text: longChapter(40) }, boxChapter(goodBox)]),
      reviewerOnly: [{ defect: 'pickup day contradicts the brief and facts (Sundays vs Saturdays)', match: /sunday/i }] },
    { id: 'book-s2', kind: 'book', seeded: true, doc: book([{ id: 'dawn', title: 'Dawn bakes', text: `${longChapter(40)}\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. TODO: replace this paragraph with the real story of the bakery.` }, boxChapter(goodBox.replace('€49', '€59'))]),
      repairedDoc: book([{ id: 'dawn', title: 'Dawn bakes', text: longChapter(40) }, boxChapter(goodBox)]),
      reviewerOnly: [{ defect: 'leftover placeholder paragraph (Lorem ipsum / TODO)', match: /lorem|placeholder|todo|filler|dummy/i }] },
    { id: 'deck-a1', kind: 'deck', seeded: false, doc: deck(slides()) },
    { id: 'deck-a2', kind: 'deck', seeded: false, doc: deck([...slides(), { id: 'visit', layout: 'points', tone: 'light', title: 'Visit us', notes: 'Opening hours.', points: [{ text: 'Pier 4' }, { text: 'Open daily from seven until two' }] }]) },
    { id: 'deck-s1', kind: 'deck', seeded: true, doc: deck(slides({ introTitle: 'Harbur Bakery: bread baked at dawn' })), damage: { chart: 'slide2.', notes: 'slide3.' }, repairedDoc: deck(slides()),
      reviewerOnly: [{ defect: 'brand name misspelt on the title slide ("Harbur")', match: /harbur|misspel|typo|spelling/i }] },
    { id: 'deck-s2', kind: 'deck', seeded: true, doc: deck(slides({ points: [{ text: '€59 per month' }, { text: 'Collected on Sundays at Pier 4' }] })), repairedDoc: deck(slides()),
      reviewerOnly: [{ defect: 'pickup day contradicts the brief and facts (Sundays vs Saturdays)', match: /sunday/i }] },
  ];
}

async function main() {
  const ctx = c.configure({ flags: { MAKEBORNE_INDEPENDENT_REVIEW: 'on' } });
  const sharp = require(path.join(c.REPO, 'node_modules', 'sharp'));
  const JSZip = require(path.join(c.REPO, 'node_modules', 'jszip'));
  const { chromium } = require(path.join(c.REPO, 'node_modules', 'playwright'));
  const capture = c.app('src/lib/review/capture-server.ts');
  const deterministic = c.app('src/lib/review/deterministic.ts');
  const { defaultClaimsCheck } = c.app('src/lib/review/claims.ts');
  const { assembleRequest, reverifyFindings } = c.app('src/lib/review/assemble.ts');
  const { contentSha, ModelReviewSchema, repairs } = c.app('src/lib/review/contract.ts');
  const { runIndependentReview } = c.app('src/lib/review/operation.ts');
  const { REVIEWER_SYSTEM, REVIEW_RESULT_DESCRIPTION, recheckText, reviewerImages, observedReviewer } = c.app('src/lib/review/reviewer.ts');
  const { repairable } = c.app('src/lib/review/validate.ts');
  const { emptyDocument } = c.app('src/lib/documents/editor.ts');
  const { documentPdf } = c.app('src/lib/documents/export-server.ts');
  const { deckPptx } = c.app('src/lib/documents/pptx.ts');
  const { resolveAgencyTask } = c.app('src/lib/agency/task.ts');
  const { runAgencyTask } = c.app('src/lib/agency/run.ts');
  const { anthropicModelPort } = c.app('src/lib/agency/model-port.ts');
  const { resolveAgencyScope } = c.app('src/lib/builder/operation-server.ts');
  const { inputReader } = c.app('src/lib/agency/inputs.ts');
  const { aiCostUsdPerCredit } = c.app('src/lib/builder/pricing.ts');
  const rate = Math.round(aiCostUsdPerCredit() * 1e6);
  const CEILING = 30;
  const settings = c.testSetting('independent_review', { maxTurns: 4, maxOutputTokens: 8000 });
  const dry = process.argv.includes('--dry');
  const round = (process.argv.find(arg => arg.startsWith('--round=')) ?? '--round=1').slice(8);
  const only = process.argv.slice(2).filter(arg => !arg.startsWith('--'));

  const browser = await chromium.launch({ headless: true });
  const launch = async () => ({ newContext: (...args) => browser.newContext(...args), close: async () => {} });
  const png = (w, h, color) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
  const logo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#1d2433"/><text x="20" y="15" font-family="Georgia" font-size="13" fill="#fbf7f0" text-anchor="middle">HB</text></svg>')).png().toBuffer();
  const assets = { '/assets/logo.png': { body: logo, contentType: 'image/png' }, '/assets/hero.png': { body: await png(800, 400, '#c9a46a'), contentType: 'image/png' } };

  async function evidence(fixture, which, subject) {
    if (fixture.kind === 'website') {
      const html = which === 'repaired' ? fixture.repaired : fixture.html;
      const captured = await capture.captureWebsite({ routes: [{ path: '/', html }], assets: async pathname => assets[pathname] ?? null, launch });
      const diagnostics = deterministic.websiteDiagnostics({ probes: captured.probes, runtimeErrors: [], facts: FACTS, claims: defaultClaimsCheck });
      return { request: assembleRequest({ subject, brief: BRIEF, facts: FACTS, evidence: captured.evidence, diagnostics, coverage: captured.coverage }), diagnostics };
    }
    const doc = which === 'repaired' ? fixture.repairedDoc : fixture.doc;
    if (fixture.kind === 'book') {
      const exportDoc = which !== 'repaired' && fixture.exportWithout ? { ...doc, chapters: doc.chapters.filter(chapter => chapter.id !== fixture.exportWithout) } : doc;
      const bytes = await documentPdf(exportDoc, {});
      const captured = await capture.captureBook(doc, {}, {}, { launch, pdf: async () => bytes });
      const diagnostics = deterministic.bookDiagnostics({ pdf: captured.pdf, exportError: captured.exportError, chapters: captured.evidence.chapters, facts: FACTS, claims: defaultClaimsCheck });
      return { request: assembleRequest({ subject, brief: BRIEF, facts: FACTS, evidence: captured.evidence, diagnostics, coverage: captured.coverage }), diagnostics };
    }
    let bytes = await deckPptx(doc, {});
    if (which !== 'repaired' && fixture.damage) {
      const zip = await JSZip.loadAsync(bytes);
      for (const name of Object.keys(zip.files).filter(item => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(item))) {
        let xml = await zip.file(name).async('string');
        if (fixture.damage.chart && name.includes(fixture.damage.chart)) xml = xml.replace(/<Relationship [^>]*\/chart"[^>]*\/>/, '');
        if (fixture.damage.notes && name.includes(fixture.damage.notes)) xml = xml.replace(/<Relationship [^>]*\/notesSlide"[^>]*\/>/, '');
        zip.file(name, xml);
      }
      bytes = await zip.generateAsync({ type: 'nodebuffer' });
    }
    const captured = await capture.captureDeck(doc, {}, {}, { launch, pptx: async () => bytes });
    const diagnostics = deterministic.deckDiagnostics({ pptx: captured.pptx, exportError: captured.exportError, probes: captured.probes, facts: FACTS, claims: defaultClaimsCheck,
      slides: doc.slides.map(slide => ({ id: slide.id, title: slide.title, notes: slide.notes, hasChart: slide.layout === 'chart' && Boolean(slide.chart) })) });
    return { request: assembleRequest({ subject, brief: BRIEF, facts: FACTS, evidence: captured.evidence, diagnostics, coverage: captured.coverage }), diagnostics };
  }
  const contentOf = (fixture, which) => fixture.kind === 'website' ? { qualification: 'review', html: which === 'repaired' ? fixture.repaired : fixture.html } : { qualification: 'review', document: which === 'repaired' ? fixture.repairedDoc : fixture.doc };
  const summarize = finding => ({ id: finding.id, source: finding.source, grounding: finding.grounding, severity: finding.severity, category: finding.category, location: finding.location,
    evidence: finding.evidence.type === 'quote' ? `quote(${finding.evidence.from}): ${finding.evidence.text}` : finding.evidence.type === 'crop' ? `crop ${finding.evidence.imageId}` : `measured ${finding.evidence.diagnosticId}`,
    brief: finding.briefRequirement?.ref ?? null, factRefs: finding.factRefs, repair: finding.proposedRepair, note: finding.note ?? null });

  for (const fixture of fixtures(emptyDocument)) {
    if (only.length && !only.includes(fixture.id)) continue;
    const kind = fixture.kind === 'deck' ? 'presentation' : fixture.kind;
    const content = contentOf(fixture, 'original');
    const created = dry ? { artifactId: '6f1c2b8e-4a1d-4c3e-9d2a-7b5e8f0a1c2d', versionId: c.randomUUID(), version: 1 } : await c.createArtifact(ctx.workspaceId, { title: `review ${fixture.id}`, kind, projectKind: kind, content, actor: ctx.actor });
    const subject = { artifactId: created.artifactId, version: 1, contentSha: contentSha(content) };
    const { request, diagnostics } = await evidence(fixture, 'original', subject);
    const measured = deterministic.deterministicFindings(request.diagnostics);
    const failedChecks = diagnostics.filter(item => item.status === 'failed').map(item => `${item.check}: ${item.measured}`.slice(0, 160));
    if (dry) { console.log(`${fixture.id}: ${request.evidence.images.length} images; failed checks: ${JSON.stringify(failedChecks)}`); continue; }
    const log = [], turns = [];
    const task = await resolveAgencyTask(ctx.actor, { artifactId: created.artifactId, actionKey: c.randomUUID(), stepKey: c.randomUUID(), kind: 'independent_review',
      objective: `Independent review of version ${subject.version} against the approved brief.`, inputs: [{ kind: 'artifact_version', id: created.versionId, version: 1 }],
      permittedTools: [], settings: 'standard', ceilingCredits: CEILING, expectedRevision: 1 }, { scope: resolveAgencyScope, settings, rateMicrousd: rate });
    const started = Date.now();
    const step = await c.paidStep(ctx, { test: 'review', boundUsd: (CEILING * rate) / 1e6, ref: `${fixture.id}#${round}`, note: `independent review: ${fixture.id}` }, () => runIndependentReview({ task, request, deterministic: measured, claims: defaultClaimsCheck, knowledgeSha256: null,
      deps: { model: c.observedPort(anthropicModelPort(c.anthropicClient(log, 100_000), task.settings), turns), tools: {}, readInput: inputReader(task), platformDeadline: Date.now() + 105_000 } }));
    const result = step.value?.result ?? null;
    const raw = turns.flatMap(turn => turn.tools.filter(tool => tool.name === 'submit_result').map(tool => tool.input)).at(-1) ?? null;
    const modelFindings = (result?.findings ?? []).filter(item => item.source === 'model');
    const detected = (fixture.reviewerOnly ?? []).map(item => {
      const hits = modelFindings.filter(finding => item.match.test(`${finding.proposedRepair} ${finding.evidence.type === 'quote' ? finding.evidence.text : ''} ${finding.briefRequirement?.quote ?? ''} ${finding.category}`));
      return { defect: item.defect, reported: hits.length > 0, grounded: hits.some(hit => hit.grounding === 'grounded'), severity: hits.map(hit => hit.severity), ids: hits.map(hit => hit.id) };
    });
    const rawIds = new Set((raw?.findings ?? []).map(item => item.id));
    const row = { round, id: fixture.id, kind: fixture.kind, seeded: fixture.seeded, status: result?.status ?? null, unavailableReason: result?.unavailableReason ?? null, reviewer: result?.reviewer ?? null,
      outcome: step.value?.run ? { outcome: step.value.run.outcome, code: step.value.run.code ?? null } : null, error: step.error ? String(step.error.message ?? step.error).slice(0, 300) : null,
      failedChecks, deterministicFindings: measured.length, modelSubmitted: raw?.findings?.length ?? 0, modelKept: modelFindings.length,
      modelDroppedAsDuplicateOfMeasured: [...rawIds].filter(id => !modelFindings.some(item => item.id === id)).length,
      unverified: modelFindings.filter(item => item.grounding === 'unverified').map(summarize),
      groundedBlockerMajor: modelFindings.filter(item => item.grounding === 'grounded' && repairs(item.severity)).map(summarize),
      detected, rawFindings: (raw?.findings ?? []).map(item => ({ id: item.id, category: item.category, severity: item.severity, location: item.location, evidence: item.evidence.type === 'quote' ? item.evidence.text : item.evidence.type, factRefs: item.factRefs, brief: item.briefRequirement?.ref ?? null, repair: item.proposedRepair.slice(0, 240) })),
      findings: (result?.findings ?? []).map(summarize), coverageNotes: result?.coverageNotes ?? [], turns: turns.length, stopReasons: turns.map(turn => turn.stopReason),
      images: request.evidence.images.length, usage: log, latencyMs: Date.now() - started, gate: step.gate, ledger: step.ledger };
    c.appendJsonl('review', row);
    console.log(`${fixture.id}: ${row.status}${row.unavailableReason ? ` (${row.unavailableReason})` : ''}; model ${row.modelKept}/${row.modelSubmitted} kept, ${row.unverified.length} unverified, grounded blocker/major ${row.groundedBlockerMajor.length}; reviewer-only ${detected.map(item => `${item.reported ? (item.grounded ? 'FOUND' : 'found-unverified') : 'MISSED'}`).join(',') || '-'}; gate $${c.usd(step.gate.totalMicrousd).toFixed(4)}; ${row.latencyMs} ms${row.error ? `; error ${row.error}` : ''}`);

    if (fixture.seeded && result && !process.argv.includes('--no-recheck')) {
      // Targeted re-check after a scripted correct repair (version 2).
      const targets = result.findings.filter(repairable);
      if (!targets.length) { c.appendJsonl('review', { check: 'recheck', id: fixture.id, skipped: 'no repairable findings in the first review' }); console.log('  recheck skipped: no repairable findings'); continue; }
      const repairedContent = contentOf(fixture, 'repaired');
      const version = await c.addVersion(ctx.workspaceId, created.artifactId, 2, repairedContent, ctx.actor);
      const subject2 = { artifactId: created.artifactId, version: 2, contentSha: contentSha(repairedContent) };
      const again = await evidence(fixture, 'repaired', subject2);
      const recheckLog = [], recheckTurns = [];
      const task2 = await resolveAgencyTask(ctx.actor, { artifactId: created.artifactId, actionKey: c.randomUUID(), stepKey: c.randomUUID(), kind: 'independent_review',
        objective: `Targeted re-check of version 2 for ${targets.length} finding(s) after a repair.`, inputs: [{ kind: 'artifact_version', id: version.id, version: 2 }],
        permittedTools: [], settings: 'standard', ceilingCredits: CEILING, expectedRevision: 2 }, { scope: resolveAgencyScope, settings, rateMicrousd: rate });
      const { port } = observedReviewer(c.observedPort(anthropicModelPort(c.anthropicClient(recheckLog, 100_000), task2.settings), recheckTurns));
      const started2 = Date.now();
      const recheck = await c.paidStep(ctx, { test: 'review', boundUsd: (CEILING * rate) / 1e6, ref: `${fixture.id}#recheck#${round}`, note: `independent review re-check: ${fixture.id}` }, () => runAgencyTask(task2,
        { system: REVIEWER_SYSTEM, result: ModelReviewSchema, resultDescription: REVIEW_RESULT_DESCRIPTION, content: [{ type: 'text', text: recheckText(again.request, targets) }, ...reviewerImages(again.request)], knowledgeInContent: true },
        { model: port, tools: {}, readInput: inputReader(task2), platformDeadline: Date.now() + 105_000 }));
      const recheckReview = recheck.value?.outcome === 'result' ? ModelReviewSchema.safeParse(recheck.value.status?.result?.data) : null;
      const verification = reverifyFindings(targets, again.request.diagnostics, recheckReview?.success ? recheckReview.data : null);
      const added = recheckReview?.success ? recheckReview.data.findings.filter(item => !targets.some(target => target.id === item.id) && repairs(item.severity)) : [];
      const recheckRow = { round, check: 'recheck', id: fixture.id, targets: targets.map(item => ({ id: item.id, source: item.source, severity: item.severity })), outcome: recheck.value ? { outcome: recheck.value.outcome, code: recheck.value.code ?? null } : null,
        error: recheck.error ? String(recheck.error.message ?? recheck.error).slice(0, 300) : null, verification, resolved: verification.filter(item => item.status === 'resolved').length,
        stillReported: recheckReview?.success ? recheckReview.data.findings.map(item => ({ id: item.id, severity: item.severity, repair: item.proposedRepair.slice(0, 200) })) : null, addedRepairTriggering: added.length,
        failedChecksAfterRepair: again.diagnostics.filter(item => item.status === 'failed').map(item => `${item.check}: ${item.measured}`.slice(0, 160)), usage: recheckLog, latencyMs: Date.now() - started2, gate: recheck.gate, ledger: recheck.ledger };
      c.appendJsonl('review', recheckRow);
      console.log(`  recheck: ${recheckRow.resolved}/${targets.length} resolved; added repair-triggering ${recheckRow.addedRepairTriggering}; gate $${c.usd(recheck.gate.totalMicrousd).toFixed(4)}${recheckRow.error ? `; error ${recheckRow.error}` : ''}`);
    }
  }
  await browser.close();
  if (!dry) console.log('review spend so far', await c.testSpend('review'));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => c.closeDb());
