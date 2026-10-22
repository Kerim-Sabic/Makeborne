/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the questions asked before a first build. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { briefQuestions, briefWithAnswers, designAnswers, designAnswerLabels, mergedQuestions, isBriefQuestion, standardQuestion } = require("./brief-questions.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const ids = (kind, brief, context) => briefQuestions(kind, brief, context).map(question => question.id);

check("a short, vague website brief gets five design questions, ranked by how much each changes the design", () => {
  for (const brief of ["Website for my bakery", "website for my dentist", "bakery site", "plumber in Leeds"])
    assert.deepEqual(ids("website", brief), ["vibe", "goal", "sections", "imagery", "theme"], brief);
  // Nightlife ranks light-or-dark above imagery; non-local subjects rank sections lower.
  assert.deepEqual(ids("website", "A cocktail bar in Glasgow"), ["vibe", "goal", "sections", "theme", "imagery"]);
  assert.deepEqual(ids("website", "SaaS tool for invoices"), ["vibe", "goal", "imagery", "theme", "sections"]);
});

check("questions the brief already answers are not asked", () => {
  assert.deepEqual(ids("website", "Bold, modern one-page site for a bakery where locals can order bread for Saturday pickup. Our logo is attached.", { attachments: 1 }), ["sections", "imagery", "theme"]);
  assert.deepEqual(ids("website", "A calm, premium site for a law firm"), ["goal", "imagery", "theme", "sections", "colour"]);
  assert.ok(!ids("website", "Landing page for my bakery so customers can order online").includes("goal"));
  assert.ok(!ids("website", "Bakery site, our colours are #8a2b1f and cream").includes("colour"), "a hex colour answers the colour question");
  assert.ok(!ids("website", "Bakery site", { attachments: 1 }).includes("colour"), "an attached logo answers the colour question");
  assert.ok(!ids("website", "A dark, moody site for a bakery").includes("theme"), "dark answers the theme");
  assert.ok(!ids("website", "Bakery site with our photos").includes("imagery"));
  assert.ok(!ids("website", "Bakery site with the menu, prices, opening hours and an FAQ").includes("sections"), "a brief listing its sections is not asked again");
});

check("long, detailed briefs get fewer questions", () => {
  const detailed = `Website for Ovenbird, a sourdough bakery on Fennel Street. ${"We bake country loaves, rye and buns overnight in a wood-fired oven and sell from a hatch. ".repeat(12)}`;
  assert.ok(detailed.split(/\s+/).length > 150);
  assert.equal(briefQuestions("website", detailed).length, 0, "a detailed website brief goes straight to building");
  assert.equal(mergedQuestions("website", detailed, [{ id: "ordering", question: "Do people order ahead?", why: "x", topic: "Ordering", options: [{ value: "a", label: "Ahead" }, { value: "b", label: "Walk in" }] }]).length, 0, "tailored questions too");
  assert.ok(briefQuestions("presentation", detailed).length > 0, "other kinds keep their questions");
  const medium = `Website for Ovenbird, a sourdough bakery. ${"We bake loaves overnight in a wood-fired oven. ".repeat(7)}`;
  assert.equal(briefQuestions("website", medium).length, 2);
  assert.equal(briefQuestions("website", "Website for Ovenbird, a sourdough bakery in Leith that bakes rye, country loaves and cardamom buns overnight and sells them from a hatch on Fennel Street").length, 4);
});

check("design answers are deterministic, only from chosen options, and skipped or free-text answers leave fields out", () => {
  const questions = briefQuestions("website", "bakery site");
  const answers = { theme: { option: "dark" }, vibe: { option: "warm" }, imagery: { option: "illustration" }, goal: { option: "visit" }, sections: { options: ["hours", "prices", "nope"] } };
  const design = designAnswers(questions, answers);
  assert.deepEqual(design, { theme: "dark", vibe: "warm", imagery: "illustration", goal: "visit", sections: ["hours", "prices"] });
  assert.deepEqual(designAnswers(questions, answers), design, "same answers, same design");
  assert.deepEqual(designAnswers(questions, { theme: { option: "auto" }, imagery: { option: "auto" }, vibe: { custom: "like a tea house" }, goal: {} }), {}, "'you choose', free text and skips set nothing");
  assert.deepEqual(designAnswers(questions.filter(question => question.id !== "theme"), answers).theme, undefined, "a question not asked cannot set a field");
  const colour = standardQuestion("website", "colour");
  assert.deepEqual(designAnswers([colour], { colour: { color: "#8A2B1F" } }), { colour: "#8a2b1f" });
  assert.deepEqual(designAnswers([colour], { colour: { option: "logo" } }), { logoColours: true });
  assert.deepEqual(designAnswerLabels(design), ["Theme: Dark", "Feel: Warm and crafted", "Imagery: Illustration", "Main action: Visit", "Sections: Opening hours, Prices or menu"]);
});

check("AI-tailored questions merge in after the top design questions, without design duplicates, within the limit", () => {
  const tailored = [
    { id: "ordering", question: "Do people order ahead, walk in, or both?", why: "Decides what leads.", topic: "How people buy", custom: "e.g. Pre-order", options: [] },
    { id: "style", question: "What should it feel like?", why: "Sets the look.", topic: "Look and feel", custom: "x", options: [] },
    { id: "photos", question: "Do you have photos of your bakes?", why: "Imagery.", topic: "Photos", custom: "x", options: [] },
    { id: "signature", question: "Which bake are you known for?", why: "The hero can feature it.", topic: "Signature bake", custom: "x", options: [] },
    { id: "delivery", question: "Do you deliver?", why: "x".repeat(10), topic: "Delivery", custom: "x", options: [] },
  ];
  const merged = mergedQuestions("website", "bakery site", tailored);
  assert.deepEqual(merged.map(question => question.id), ["vibe", "goal", "sections", "ordering", "signature"], "at most two tailored, design topics dropped, five in total");
  assert.deepEqual(mergedQuestions("website", "bakery site", null).map(question => question.id), ids("website", "bakery site"), "on-device set when the AI is unavailable");
  assert.deepEqual(mergedQuestions("presentation", "deck", tailored.slice(0, 1)).map(question => question.id), ["ordering", "slides"], "other kinds keep the tailored set, plus the slide-style option");
  assert.deepEqual(mergedQuestions("book", "A cookbook", [{ id: "pics", question: "Do you want photos of each recipe?", why: "x", topic: "Photos", custom: "x", options: [] }, tailored[0]]).map(question => question.id), ["images", "ordering", "imagestyle"], "a tailored picture question gives way to the image-plan options");
  for (const question of merged) assert.ok(isBriefQuestion(question), question.id);
});

check("presentations ask about purpose, delivery, look and length, then offer the slide style", () => {
  assert.deepEqual(ids("presentation", "Deck about our water sensors"), ["purpose", "delivery", "style", "length", "slides"]);
  assert.deepEqual(ids("presentation", "10-slide investor pitch I'll present live, bold and modern"), ["slides"]);
  assert.deepEqual(ids("presentation", "Sales proposal we will email to the client"), ["style", "length", "slides"]);
  assert.deepEqual(ids("presentation", "Sales proposal we will email, editable in PowerPoint"), ["style", "length"], "a brief that asks for editable slides is not asked again");
  const slides = standardQuestion("presentation", "slides");
  assert.deepEqual(slides.options.map(option => option.label), ["Full-image slides", "Editable text slides", "You choose"]);
  assert.ok(isBriefQuestion(slides));
});

check("books ask how many pictures first and their style last, besides kind, reader, tone and length", () => {
  assert.deepEqual(ids("book", "Something about personal finance"), ["images", "type", "reader", "tone", "length", "imagestyle"]);
  assert.deepEqual(ids("book", "A short, friendly guide for freelancers on cash flow"), ["images", "imagestyle"]);
  assert.deepEqual(ids("book", "A short, friendly guide for freelancers on cash flow, no images"), [], "no images: neither image question");
  assert.deepEqual(ids("book", "A short, friendly guide for freelancers on cash flow, one picture every 4 pages in watercolour"), []);
  const images = standardQuestion("book", "images"), style = standardQuestion("book", "imagestyle");
  assert.deepEqual(images.options.map(option => option.value), ["none", "cover", "openers", "every6", "every3", "rich"]);
  assert.deepEqual(style.options.map(option => option.value), ["photo", "illustration", "technique", "auto"]);
  for (const question of [images, style]) assert.ok(isBriefQuestion(question), question.id);
});

check("answers are written into the brief in plain words; skipped questions are left out", () => {
  const questions = briefQuestions("website", "Website for my bakery");
  const brief = briefWithAnswers("Website for my bakery", questions, { goal: { option: "buy" }, vibe: { option: "warm" }, sections: { options: ["hours", "faq"] }, imagery: { custom: "  Hand-drawn\nloaves  " } });
  assert.equal(brief, "Website for my bakery\n\nThe client's answers to Makeborne's questions (follow them):\n- Look and feel: Warm and crafted (Earthy colours, texture, characterful type)\n- Main thing visitors should do: Buy\n- Must-have sections: Opening hours, FAQ\n- Imagery: Hand-drawn loaves");
  assert.equal(briefWithAnswers("  Website for my bakery ", questions, {}), "Website for my bakery", "no answers leave the brief unchanged");
  assert.equal(briefWithAnswers("x", questions, { goal: { option: "not-an-option" } }), "x", "unknown options are ignored");
  assert.equal(briefWithAnswers("x", questions, { sections: { options: [] } }), "x", "an empty multi-select adds nothing");
  assert.ok(briefWithAnswers("x", questions, { goal: { custom: "y".repeat(500) } }).length < 400, "own answers are capped");
  assert.equal(briefWithAnswers("x", [standardQuestion("website", "colour")], { colour: { color: "#8A2B1F" } }), "x\n\nThe client's answers to Makeborne's questions (follow them):\n- Brand colour: #8a2b1f");
  assert.equal(briefWithAnswers("x", [standardQuestion("website", "colour")], { colour: { color: "red" } }), "x", "an invalid colour is ignored");
});

check("every question is complete and option values are unique", () => {
  for (const kind of ["website", "presentation", "book"]) for (const question of briefQuestions(kind, "")) {
    assert.ok(question.question.endsWith("?") && question.why && question.topic && question.custom, `${kind}/${question.id}`);
    assert.ok(question.options.length >= (question.color ? 2 : 3) && question.options.length <= (question.multi ? 8 : 6), question.id);
    assert.equal(new Set(question.options.map(option => option.value)).size, question.options.length);
    assert.ok(isBriefQuestion(question), `${kind}/${question.id} passes the client-side check`);
  }
  assert.ok(standardQuestion("website", "colour").color && standardQuestion("website", "sections").multi);
  assert.ok(standardQuestion("website", "theme").options.filter(option => option.swatch).length === 2 && standardQuestion("website", "vibe").options.every(option => option.swatch), "theme and vibe show swatches");
});

check("F04: a skipped answer never reaches the brief, including on the last question", () => {
  const questions = briefQuestions("website", "Website for my bakery");
  const skipped = Object.fromEntries(questions.map(question => [question.id, {}]));
  assert.equal(briefWithAnswers("Website for my bakery", questions, skipped), "Website for my bakery", "cleared answers add nothing");
  // The card hands the cleared answers straight to onStart on the last question (mounted journey: scripts/check-brief-skip-browser.cjs).
  const card = fs.readFileSync(require("node:path").join(__dirname, "..", "..", "components", "brief-questions-card.tsx"), "utf8");
  assert.ok(card.includes("const cleared: BriefAnswers = { ...answers, [question.id]: {} };"), "skip computes the cleared answers once");
  assert.ok(card.includes("if (last) onStart(cleared); else setStep(step + 1);"), "the final skip starts with the cleared answers, not the stale closure");
});

console.log(`\n${passed} brief question checks passed.`);
