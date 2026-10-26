/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for vision-checked images: the builder sees every generated image, regenerates a rejected slot at most once, the review may regenerate one image (never on type-only designs), the image plan, and the token bounds with images in the history. No network. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict"), Module = require("node:module");
const sharp = require("sharp");
const load = Module._load, script = [], seen = [];
let testModels = ["gpt-image-2"];
let imageBytes = null;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.resolve(process.cwd(), "src", name.slice(2)), parent, main);
  const fromAgent = /builder[\\/]agent\.ts$/.test(parent?.filename ?? "");
  // A scripted provider: each call returns the next assistant message and records what it was sent.
  if (name === "../ai/anthropic-call" && fromAgent) return { ContextMeter: class { afterReply() {} }, builderModels: () => ["claude-opus-5-5"], budgetedStream: async input => {
    const next = script.shift();
    if (!next) throw new Error("script exhausted");
    seen.push({ tools: input.params.tools.map(tool => tool.name), messages: JSON.parse(JSON.stringify(input.params.messages)) });
    return { message: { content: next.content, stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 10 } } };
  } };
  if (name === "./images" && fromAgent) return { imageConfiguration: () => ({ model: testModels[0], models: [...testModels], issue: null }), IMAGE_SIZES: { landscape: "1536x1024", portrait: "1024x1536", square: "1024x1024" }, openaiImageClient: () => ({}) };
  // The image provider: every call returns the fixture picture; nothing is sent anywhere.
  if (name === "../ai/image-call" && fromAgent) return { startBudgetedImage: async input => {
    imageCalls.push(input);
    return { done: Promise.resolve(imageBytes), detail: Promise.resolve({ model: input.model, quality: input.quality, size: input.size, boundMicrousd: 1, costMicrousd: 42_000, outputTokens: 1000, boundOutputTokens: 2000, overrun: false }) };
  } };
  return load.call(this, name, parent, main);
};
const imageCalls = [];
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);

// Comp-first builds are off by default (MAKEBORNE_DESIGN_COMPS, lib/builder/features.ts); these checks exercise them on.
process.env.MAKEBORNE_DESIGN_COMPS = "on";
const { runBuilder, regenerationProblem, imageReadyMessage, IMAGE_INSPECTION, compPrompt } = require("./agent.ts");
const { designCompBlocks } = require("./design-comps.ts");
const { ProjectFiles } = require("./files.ts");
const { checkConcept, imagePlanNote, sitePlanNote, conceptComment, compsFromSource, MAX_COMPS, CONCEPT_TOOL } = require("./concept.ts");
const SITE_PLAN = { artSystem: { palette: "workshop green ground, brass accent, ink from chain grease", type: "Archivo condensed caps for display, Inter text", imagery: "one documentary photographer, overcast window light", motif: "a spoke ruler under every heading", motion: "rises and one wipe" },
  sections: [{ id: "top", composition: "full-bleed-photo", job: "the bench at work" }, { id: "rates", composition: "giant-numeral", job: "the flat-tyre price" }, { id: "work", composition: "editorial-split", job: "what a service covers" }, { id: "visit", composition: "contact-card", job: "hours and address" }] };
const { reviewImageLimit } = require("./review-policy.ts");
const { reviewRequest } = require("./review.ts");
const { BUILDER_SYSTEM } = require("./prompt.ts");
const { imagePreview, IMAGE_PREVIEW_EDGE } = require("./image-variants.ts");
const { ContextMeter, messageTokenBound, imageTokenBound, base64ImageSize, IMAGE_TOKENS_UNKNOWN } = require("../ai/anthropic-call.ts");

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

/** A real picture with detail (noise), so the encoders produce realistic sizes. */
async function picture(width, height, options = {}) {
  const raw = Buffer.alloc(width * height * 3);
  for (let index = 0; index < raw.length; index++) raw[index] = (index * 2654435761) >>> 24;
  const image = sharp(raw, { raw: { width, height, channels: 3 } });
  return options.format === "png" ? image.png().toBuffer() : options.format === "jpeg" ? image.jpeg({ quality: 80 }).toBuffer() : image.webp({ quality: 76 }).toBuffer();
}

const write = (id, filePath, content) => ({ type: "tool_use", id, name: "write_file", input: { path: filePath, content } });
const gen = (id, input) => ({ type: "tool_use", id, name: "generate_image", input: { aspect: "landscape", prompt: "A mechanic's hands truing a bicycle wheel on a worn bench, morning light from the left", ...input } });
const site = (id, image = "hero-bench") => [
  write(`${id}a`, "index.html", '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Spokes</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'),
  write(`${id}b`, "src/main.tsx", 'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);\n'),
  write(`${id}c`, "src/App.tsx", `export default function App() { return <main><h1>Wheels trued while you wait</h1><img src="/images/${image}.webp" width="1536" height="1024" alt="A wheel on the truing stand" /></main>; }\n`),
];
const finish = id => ({ type: "tool_use", id, name: "finish", input: { summary: "Built the workshop site.", title: "Spokes" } });

async function run(extra = {}, files = new ProjectFiles()) {
  const events = [];
  const deadline = Date.now() + 280_000;
  const spend = { allowanceMicrousd: 1_500_000, remainingMicrousd: 1_500_000, providerMicrousd: 0, uncertainMicrousd: 0, stopped: null, deadline, customerCredits: () => 0, timeLeftMs: () => 200_000 };
  let sha = 0;
  const storeImage = async (request, bytes) => {
    const meta = await sharp(bytes).metadata();
    const digest = String(++sha).padStart(2, "0").repeat(32);
    return { id: `0000000${sha}-0000-5000-a000-000000000000`, path: `public/images/${request.name}.webp`, sha256: digest, bytes: bytes.length, mediaType: "image/webp", url: `/images/${request.name}.webp`,
      width: meta.width, height: meta.height, transparent: false, data: bytes,
      variants: [{ id: `1000000${sha}-0000-5000-a000-000000000000`, path: `public/images/_r/${digest.slice(0, 16)}-${meta.width}x${meta.height}/640.webp`, sha256: "f".repeat(64), bytes: 100, mediaType: "image/webp" }] };
  };
  const result = await runBuilder({ client: {}, scope: { workspaceId: "w", projectId: "p" }, files, effort: "medium", spend, request: "Website for a bicycle workshop", context: "Fixture",
    attachments: [], emit: event => events.push(event), signal: new AbortController().signal, deadline, anthropic: {}, compile: async () => ({ status: "passed" }), stepGuardMs: 0, storeImage, ...extra });
  return { files, events, result };
}
/** The tool_result blocks the model received in its latest request. */
const lastResults = () => seen.at(-1).messages.at(-1).content.filter(block => block.type === "tool_result");

(async () => {
  imageBytes = await picture(1536, 1024);

  await check("the builder sees every generated image: the tool result carries a small image block and the inspection instruction", async () => {
    script.length = 0; seen.length = 0; imageCalls.length = 0;
    script.push({ content: [gen("g1", { name: "hero-bench" })] }, { content: [...site("s"), finish("f1")] });
    const { result, files } = await run();
    assert.ok(result.finished);
    assert.match(seen[0].messages[0].content.at(-1).text, /each image comes back to you as a picture: inspect it before you place it/);
    const [toolResult] = lastResults();
    assert.ok(Array.isArray(toolResult.content), "content is a block array, not text only");
    const [image, text] = toolResult.content;
    assert.equal(image.type, "image"); assert.equal(image.source.type, "base64"); assert.equal(image.source.media_type, "image/webp");
    const size = await sharp(Buffer.from(image.source.data, "base64")).metadata();
    assert.ok(Math.max(size.width, size.height) <= IMAGE_PREVIEW_EDGE, "a downscaled preview, not the original");
    assert.equal(size.width, 768); assert.equal(size.height, 512);
    assert.ok(size.width * size.height / 750 < 1000, "under ~1k image tokens");
    assert.ok(image.source.data.length < 200_000, "small request payload");
    assert.equal(text.type, "text");
    assert.match(text.text, /^Image ready\. Use src="\/images\/hero-bench\.webp" width="1536" height="1024"/);
    assert.ok(text.text.includes(IMAGE_INSPECTION));
    assert.match(text.text, /malformed hands/); assert.match(text.text, /gibberish lettering/); assert.match(text.text, /plastic skin/); assert.match(text.text, /wrong subject/); assert.match(text.text, /a break with the set/); assert.match(text.text, /3D render beside illustrations/);
    assert.match(text.text, /replaces="hero-bench"/); assert.match(text.text, /regenerated at most once/);
    assert.match(text.text, /focal point/); assert.match(text.text, /object-position per breakpoint/); assert.match(text.text, /calm side/);
    assert.ok(files.assets.has("public/images/hero-bench.webp"));
    const tool = seen[0].tools.includes("generate_image");
    assert.ok(tool, "the image tool is offered");
  });

  await check("a preview that cannot be made leaves a text-only result (no broken image block)", async () => {
    assert.equal(imageReadyMessage({ url: "/images/h.webp" }, "landscape", "photo"), 'Image ready. Use src="/images/h.webp" (photo, landscape).');
    const saved = imageBytes;
    imageBytes = Buffer.from("not an image");
    script.length = 0; seen.length = 0;
    script.push({ content: [gen("g2", { name: "hero-bench" })] }, { content: [...site("t"), finish("f2")] });
    // storeImage reads the bytes with sharp, so use a store that does not.
    const files = new ProjectFiles();
    const storeImage = async request => ({ id: "00000009-0000-5000-a000-000000000000", path: `public/images/${request.name}.webp`, sha256: "9".repeat(64), bytes: 12, mediaType: "image/webp", url: `/images/${request.name}.webp`, width: 1536, height: 1024 });
    await run({ storeImage }, files);
    const [toolResult] = lastResults();
    assert.equal(typeof toolResult.content, "string"); assert.match(toolResult.content, /^Image ready/);
    imageBytes = saved;
  });

  await check("a rejected image is regenerated once per slot: the replacement counts, the rejected image leaves the project, no second regeneration", async () => {
    script.length = 0; seen.length = 0; imageCalls.length = 0;
    script.push(
      { content: [gen("g1", { name: "hero-bench" })] },
      { content: [gen("g2", { name: "hero-bench-2", replaces: "hero-bench", rejected: "The spokes melt into the rim and the left hand has six fingers." })] },
      { content: [gen("g3", { name: "hero-bench-3", replaces: "hero-bench-2", rejected: "Still a warped rim at the valve." }), gen("g4", { name: "hero-bench-4", replaces: "hero-bench", rejected: "Trying the first slot again." })] },
      { content: [...site("u", "hero-bench-2"), finish("f3")] });
    const { result, files, events } = await run();
    assert.ok(result.finished);
    assert.equal(imageCalls.length, 2, "the original and one regeneration; the third and fourth were refused before any provider call");
    assert.ok(!files.assets.has("public/images/hero-bench.webp"), "the rejected image is no longer in the project");
    assert.ok(![...files.assets.keys()].some(key => key.startsWith(`public/images/_r/${"01".repeat(8)}-`)), "and neither are its responsive copies");
    assert.ok(files.assets.has("public/images/hero-bench-2.webp"));
    const start = events.find(event => event.type === "image_start" && event.replaces);
    assert.deepEqual([start.name, start.replaces, start.rejected], ["hero-bench-2", "hero-bench", "The spokes melt into the rim and the left hand has six fingers."], "the rejection is recorded in the run events");
    const replaced = seen[2].messages.at(-1).content.find(block => block.type === "tool_result");
    assert.match(replaced.content.at(-1).text, /This regenerates hero-bench/); assert.match(replaced.content.at(-1).text, /cannot be regenerated again/);
    const refusals = events.filter(event => event.type === "tool_error" && event.tool === "generate_image").map(event => event.message);
    assert.equal(refusals.length, 2);
    assert.match(refusals[0], /already a regenerated image: each slot is regenerated at most once/);
    assert.match(refusals[1], /already been regenerated once/);
  });

  await check("a regeneration never leaves a broken image: the rejected image stays while the code uses it, finish asks once to point the slot at the new one", async () => {
    // The run ends right after the regeneration, before any code change (the review round that ran out of turns).
    script.length = 0; seen.length = 0;
    script.push({ content: [gen("g1", { name: "hero-bench" })] }, { content: [...site("x"), gen("g2", { name: "hero-bench-2", replaces: "hero-bench", rejected: "The rim is warped where the spokes meet it." })] });
    const ended = await run({ limits: { maxTurns: 2 } });
    assert.ok(!ended.result.finished);
    assert.ok(ended.files.assets.has("public/images/hero-bench.webp"), "still referenced by App.tsx, so it stays");
    assert.ok(ended.files.assets.has("public/images/hero-bench-2.webp"));
    assert.deepEqual(ended.files.problems(), [], "no reference to a missing image");
    // The same regeneration with time to finish: the first finish is asked to swap the slot, the repeat is accepted.
    script.length = 0; seen.length = 0;
    script.push({ content: [gen("g1", { name: "hero-bench" })] }, { content: [...site("y"), gen("g2", { name: "hero-bench-2", replaces: "hero-bench", rejected: "The rim is warped where the spokes meet it." })] },
      { content: [finish("f1")] }, { content: [finish("f2")] });
    const asked = await run();
    assert.ok(asked.result.finished);
    const stale = asked.events.find(event => event.type === "tool_error" && event.tool === "finish");
    assert.match(stale.message, /still shows \/images\/hero-bench\.webp, which you rejected and regenerated as \/images\/hero-bench-2\.webp/);
    assert.ok(asked.files.assets.has("public/images/hero-bench.webp"), "kept while in use: never a broken image");
    assert.equal(script.length, 0);
  });

  await check("a stage whose remaining budget cannot pay for one image is not offered the image tool (round 3E w05 BUILD_INCOMPLETE)", async () => {
    script.length = 0; seen.length = 0;
    script.push({ content: [...site("b"), finish("fb")] });
    const deadline = Date.now() + 280_000;
    const spend = { allowanceMicrousd: 1_500_000, remainingMicrousd: 160_000, providerMicrousd: 0, uncertainMicrousd: 0, stopped: null, deadline, customerCredits: () => 0, timeLeftMs: () => 200_000 };
    await run({ spend });
    assert.ok(!seen[0].tools.includes("generate_image"));
    assert.match(seen[0].messages[0].content.at(-1).text, /Image generation: unavailable/);
  });

  await check("block-don't-accept: covered text blocks finish every time, and a run that ends with it restores the last version without it", async () => {
    script.length = 0; seen.length = 0;
    const bad = 'export default function App() { return <main><h1>Wheels trued while you wait</h1><img src="/images/hero-bench.webp" width="1536" height="1024" alt="" style={{ position: "absolute", top: 0 }} /></main>; }\n';
    script.push({ content: [gen("g1", { name: "hero-bench" })] }, { content: [...site("c"), finish("f1")] }, { content: [write("w2", "src/App.tsx", bad), finish("f2")] }, { content: [finish("f3")] });
    const checks = [["Contrast: p \"Muted\" is 3.1:1 and needs 4.5:1."], ["Covered text: \"Wheels trued while you wait\" (h1) is hidden under img at 1440 px wide."], ["Covered text: \"Wheels trued while you wait\" (h1) is hidden under img at 1440 px wide."]];
    const seenOptions = [];
    const { result, files, events } = await run({ limits: { maxTurns: 4 }, contrastCheck: async (_files, options) => { seenOptions.push(options); return checks.shift() ?? []; } });
    assert.ok(!result.finished, "the repeated covered text was not accepted");
    assert.equal(events.filter(event => event.type === "tool_error" && /Covered text/.test(event.message)).length, 2, "blocked both times");
    assert.doesNotMatch(files.files.get("src/App.tsx"), /position: "absolute"/, "the defect was not saved");
    assert.match(files.files.get("src/App.tsx"), /Wheels trued while you wait/);
    assert.ok(events.some(event => event.type === "status" && /Restored the last version without layout defects/.test(event.message)));
    assert.equal(seenOptions[0], undefined, "no comp readings, no fidelity options");
    // The static reduced-motion band rule blocks every time too.
    const { BLOCKING_PROBLEM } = require("./contrast-gate-rules.ts");
    assert.ok(BLOCKING_PROBLEM.test("Under prefers-reduced-motion .marquee-track wraps a marquee or tag band into several rows: keep it one row"));
    assert.ok(BLOCKING_PROBLEM.test("Page overflow: the page is 25 px wider than the screen at 390 px wide") && BLOCKING_PROBLEM.test("Wrapped band: ul.track") && BLOCKING_PROBLEM.test("Cut off: div.hero"));
    assert.ok(!BLOCKING_PROBLEM.test("Contrast: p") && !BLOCKING_PROBLEM.test("Comp fidelity: the top section"), "contrast and fidelity block once (a repeat goes ahead)");
    // A fidelity finding whose measured numbers moved after a partial fix is the same problem: blocked once only (round G2 w01).
    script.length = 0; seen.length = 0;
    script.push({ content: [...site("d"), finish("g1")] }, { content: [finish("g2")] });
    const moving = [["Comp fidelity: the \"menu\" section (desktop) is off its comp: give the image about 20% of the first 960 px of the section as in the comp (it covers 4%)"], ["Comp fidelity: the \"menu\" section (desktop) is off its comp: give the image about 20% of the first 960 px of the section as in the comp (it covers 9%)"]];
    const settled = await run({ contrastCheck: async () => moving.shift() ?? [] });
    assert.ok(settled.result.finished, "the re-measured fidelity finding is accepted on the repeat");
  });

  await check("regeneration rules: a new name, an existing generated image, never the client's own photos or logo; replaces and rejected go together", () => {
    const state = { replaceOnly: false, exists: name => ["hero", "photo-1", "brand-logo"].includes(name), replaced: new Set(), replacements: new Set() };
    assert.equal(regenerationProblem({ name: "hero-2" }, state), null, "a new image needs no replaces outside a review");
    assert.equal(regenerationProblem({ name: "hero-2", replaces: "hero" }, state), null);
    assert.match(regenerationProblem({ name: "hero", replaces: "hero" }, state), /new name/);
    assert.match(regenerationProblem({ name: "x-2", replaces: "missing" }, state), /no generated image named missing/);
    assert.match(regenerationProblem({ name: "p-2", replaces: "photo-1" }, state), /client's own image/);
    assert.match(regenerationProblem({ name: "l-2", replaces: "brand-logo" }, state), /client's own image/);
    assert.match(regenerationProblem({ name: "new" }, { ...state, replaceOnly: true }), /only regenerates an existing image/);
    assert.equal(regenerationProblem({ name: "hero-2", replaces: "hero" }, { ...state, replaceOnly: true }), null);
  });

  await check("a review pass may only regenerate an existing image: adding a new one is refused", async () => {
    script.length = 0; seen.length = 0; imageCalls.length = 0;
    const files = new ProjectFiles();
    for (const file of site("r")) files.write(file.input.path, file.input.content);
    files.addAsset({ id: "0000000a-0000-5000-a000-000000000000", path: "public/images/hero-bench.webp", sha256: "a".repeat(64), bytes: 1000, mediaType: "image/webp" });
    script.push({ content: [gen("g1", { name: "extra-shot" })] }, { content: [gen("g2", { name: "hero-bench-2", replaces: "hero-bench", rejected: "Gibberish lettering on the workshop sign." })] },
      { content: [write("w1", "src/App.tsx", files.files.get("src/App.tsx").replace("hero-bench", "hero-bench-2")), finish("f4")] });
    const { events, result } = await run({ limits: { maxTurns: 6, maxImages: 1, replaceOnly: true } }, files);
    assert.ok(result.finished);
    assert.match(seen[0].messages[0].content.at(-1).text, /available only to regenerate one existing image/);
    assert.ok(events.some(event => event.type === "tool_error" && /only regenerates an existing image/.test(event.message)));
    assert.equal(imageCalls.length, 1);
    assert.ok(files.assets.has("public/images/hero-bench-2.webp") && !files.assets.has("public/images/hero-bench.webp"));
    // With 0 images (type-only design) the tool is not offered at all.
    script.length = 0; seen.length = 0;
    script.push({ content: [finish("f5")] });
    await run({ limits: { maxTurns: 6, maxImages: 0, replaceOnly: true } }, files);
    assert.ok(!seen[0].tools.includes("generate_image"));
  });

  await check("review stage image allowance: 1 when the site has generated images, 0 for type-only designs or image-free sites; the route and the eval runner wire it", () => {
    assert.equal(reviewImageLimit({ imagery: "photo", siteImages: 4 }), 1);
    assert.equal(reviewImageLimit({ imagery: undefined, siteImages: 1 }), 1);
    assert.equal(reviewImageLimit({ imagery: "type", siteImages: 4 }), 0, "type-only design");
    assert.equal(reviewImageLimit({ imagery: "illustration", siteImages: 0 }), 0, "nothing to regenerate");
    const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/build/route.ts"), "utf8");
    assert.match(route, /reviewImageLimit\(\{ imagery: operation\.originalDesign\?\.imagery, siteImages: generatedImages \}\)/);
    assert.match(route, /maxTurns: Math\.min\(REVIEW_MAX_TURNS, policy\.maxTurns\), maxImages: reviewImages, replaceOnly: true/);
    assert.match(route, /reviewCreditCeiling\(policy\.ceilingCredits\)/, "the review keeps its existing credit ceiling");
    const direct = fs.readFileSync(path.join(process.cwd(), "scripts/eval/direct-run.mjs"), "utf8");
    assert.match(direct, /replaceOnly: true,\s+maxImages: reviewImageLimit\(/);
    const rubric = reviewRequest({ round: 1, screenshots: [], viewports: [], errors: ["x"] });
    assert.match(rubric, /5\. Art direction against the plan/); assert.match(rubric, /6\. Imagery/); assert.match(rubric, /reads as AI-made/); assert.match(rubric, /a bad crop/); assert.match(rubric, /fighting its text/); assert.match(rubric, /placed without purpose/);
    assert.match(rubric, /At most one, never the client's own photos or logo/);
    assert.match(rubric, /Illustrative image/, "the honesty rules stay part of the review");
  });

  await check("the image set is planned before generating: the prompt rule and the concept tool's shot list", () => {
    assert.match(BUILDER_SYSTEM, /Plan the set before generating anything/);
    assert.match(BUILDER_SYSTEM, /No image without a job; no two images doing the same job\./);
    assert.match(BUILDER_SYSTEM, /one house style sentence: one photographer or artist, one day and its light, one colour grade drawn from the palette/i);
    assert.match(BUILDER_SYSTEM, /Inspect every image before you use it/);
    assert.match(BUILDER_SYSTEM, /A slot is regenerated at most once/);
    assert.match(BUILDER_SYSTEM, /never images as filler in uniform card grids/i);
    assert.match(BUILDER_SYSTEM, /caption every generated mood or context image visibly as "Illustrative image"/, "honesty rules unchanged");
    assert.ok(CONCEPT_TOOL.input_schema.properties.imagePlan, "the concept tool has the image plan");
    const concept = (name, headline, device) => ({ name, headline, angle: `An angle for ${name}`, device, archetype: "Editorial split", ground: "a workshop green", action: "book a repair", scores: { memorable: 4, specific: 4, action: 4, buildable: 4 } });
    const base = { concepts: [concept("Truing stand", "Wheels trued while you wait", "a spoke-tension gauge"), concept("Repair ticket", "Your bike, ticketed", "a numbered repair ticket")], chosen: 0, why: "The gauge is the craft." };
    const shot = (section, job) => ({ section, job, shot: "close detail", aspect: "landscape", focal: "hands at left third; calm wall at right", layout: "editorial split bleeding off the right edge" });
    const plan = { houseStyle: "Shot by one documentary photographer on a single overcast morning, 35mm, muted greens and brass.", shots: [shot("hero", "Show the craft of truing a wheel by hand"), shot("services", "Explain what a full service covers on the bench")] };
    assert.ok(checkConcept(base).ok, "without images the plan is not needed");
    assert.match(checkConcept(base, { images: 6 }).problem, /add imagePlan/);
    const ok = checkConcept({ ...base, imagePlan: plan }, { images: 6 });
    assert.ok(ok.ok); assert.equal(ok.record.imagePlan.shots.length, 2);
    assert.match(checkConcept({ ...base, imagePlan: { ...plan, shots: [...plan.shots, ...plan.shots, ...plan.shots, shot("extra", "Another distinct job here")] } }, { images: 6 }).problem, /allows 6/);
    assert.match(checkConcept({ ...base, imagePlan: { ...plan, shots: [plan.shots[0], shot("gallery", "Show the craft of truing a wheel by hand")] } }, { images: 6 }).problem, /do the same job/);
    const note = imagePlanNote(plan);
    assert.match(note, /2 images/); assert.ok(note.includes(plan.houseStyle)); assert.match(note, /inspect each one/); assert.match(note, /all the calls in one response/);
  });

  await check("the art system and section plan: required on a first build, no composition twice in a row, at least four, recorded in the source", () => {
    const concept = (name, headline, device) => ({ name, headline, angle: `An angle for ${name}`, device, archetype: "Editorial split", ground: "a workshop green", action: "book a repair", scores: { memorable: 4, specific: 4, action: 4, buildable: 4 } });
    const base = { concepts: [concept("Truing stand", "Wheels trued while you wait", "a spoke-tension gauge"), concept("Repair ticket", "Your bike, ticketed", "a numbered repair ticket")], chosen: 0, why: "The gauge is the craft." };
    assert.ok(checkConcept(base).ok, "edits and older callers need no plan");
    assert.match(checkConcept(base, { sitePlan: true }).problem, /art system .* section plan/);
    const repeat = { ...SITE_PLAN, sections: [SITE_PLAN.sections[0], { ...SITE_PLAN.sections[1], composition: "full-bleed-photo" }, ...SITE_PLAN.sections.slice(2)] };
    assert.match(checkConcept({ ...base, ...repeat }, { sitePlan: true }).problem, /both use the full-bleed-photo composition/);
    const few = { ...SITE_PLAN, sections: [SITE_PLAN.sections[0], SITE_PLAN.sections[1], SITE_PLAN.sections[0], SITE_PLAN.sections[1]] };
    assert.match(checkConcept({ ...base, ...few }, { sitePlan: true }).problem, /uses 2 compositions across 4 sections; use at least 4/);
    assert.ok(!checkConcept({ ...base, ...SITE_PLAN, sections: [{ id: "top", composition: "carousel", job: "a slider of photos" }, ...SITE_PLAN.sections] }, { sitePlan: true }).ok, "only named compositions");
    const ok = checkConcept({ ...base, ...SITE_PLAN }, { sitePlan: true });
    assert.ok(ok.ok); assert.equal(ok.record.sections.length, 4); assert.match(ok.record.artSystem.motif, /spoke ruler/);
    const comment = conceptComment(ok.record);
    assert.match(comment, / \* {3}Art system: palette .*motif a spoke ruler/); assert.match(comment, / \* {3}Sections: top = full-bleed-photo, rates = giant-numeral, work = editorial-split, visit = contact-card\./);
    const note = sitePlanNote(ok.record);
    assert.match(note, /repeat it in every section/); assert.match(note, /rates = giant-numeral \(one huge figure/);
    assert.match(BUILDER_SYSTEM, /Never the same composition in two consecutive sections, at least four different compositions/);
    assert.match(BUILDER_SYSTEM, /TYPE WITH DRAMA/); assert.match(BUILDER_SYSTEM, /clamp\(4\.5rem, 13vw, 10rem\)/);
    assert.ok(CONCEPT_TOOL.input_schema.properties.sections.items.properties.composition.enum.includes("type-statement"));
  });

  await check("the concept with an image plan reaches the model and the run events", async () => {
    script.length = 0; seen.length = 0;
    const concept = (name, headline, device) => ({ name, headline, angle: `An angle for ${name}`, device, archetype: "Editorial split", ground: "a workshop green", action: "book a repair", scores: { memorable: 4, specific: 4, action: 4, buildable: 4 } });
    const input = { concepts: [concept("Truing stand", "Wheels trued while you wait", "a spoke-tension gauge"), concept("Repair ticket", "Your bike, ticketed", "a numbered repair ticket")], chosen: 0, why: "The gauge is the craft.", ...SITE_PLAN,
      imagePlan: { houseStyle: "One documentary photographer, one overcast morning, 35mm, muted greens and brass.", shots: [{ section: "hero", job: "Show the craft of truing a wheel", shot: "close detail", aspect: "landscape", focal: "hands left; calm right", layout: "editorial split" }] } };
    script.push({ content: [{ type: "tool_use", id: "c1", name: "concept", input }, ...site("v")] }, { content: [gen("g1", { name: "hero-bench" })] }, { content: [finish("f6")] });
    const { events } = await run({ concept: true });
    assert.equal(events.find(event => event.type === "concept").shots, 1);
    const recorded = seen[1].messages.at(-1).content.find(block => block.type === "tool_result" && /Concept recorded/.test(block.content));
    assert.match(recorded.content, /Image plan recorded \(1 image\)/);
  });

  await check("comp-first is off unless MAKEBORNE_DESIGN_COMPS=on: a first build with a text-capable model is offered neither generate_comp nor read_comp", async () => {
    testModels = ["gpt-image-2.5-flare", "gpt-image-2"];
    delete process.env.MAKEBORNE_DESIGN_COMPS;
    try {
      script.length = 0; seen.length = 0; imageCalls.length = 0;
      script.push({ content: [...site("q"), finish("fq")] }, { content: [finish("fq2")] });
      await run({ concept: true });
      assert.ok(!seen[0].tools.includes("generate_comp") && !seen[0].tools.includes("read_comp"), "no comp tools while the flag is off");
      assert.equal(imageCalls.length, 0, "no image call was made for comps");
    } finally { process.env.MAKEBORNE_DESIGN_COMPS = "on"; testModels = ["gpt-image-2"]; }
  });

  await check("comp-first: design comps after the concept, shown to the builder at 1024 px, never registered as site images, recorded for the review", async () => {
    testModels = ["gpt-image-2.5-flare", "gpt-image-2"];
    try {
      script.length = 0; seen.length = 0; imageCalls.length = 0;
      const concept = (name, headline, device) => ({ name, headline, angle: `An angle for ${name}`, device, archetype: "Editorial split", ground: "a workshop green", action: "book a repair", scores: { memorable: 4, specific: 4, action: 4, buildable: 4 } });
      const input = { concepts: [concept("Truing stand", "Wheels trued while you wait", "a spoke-tension gauge"), concept("Repair ticket", "Your bike, ticketed", "a numbered repair ticket")], chosen: 0, why: "The gauge is the craft.", ...SITE_PLAN,
        imagePlan: { houseStyle: "One documentary photographer, one overcast morning, 35mm, muted greens and brass.", shots: [{ section: "top", job: "Show the craft of truing a wheel", shot: "close detail", aspect: "landscape", focal: "hands left; calm right", layout: "editorial split" }] } };
      const comp = (id, section, viewport = "desktop") => ({ type: "tool_use", id, name: "generate_comp", input: { section, viewport, brand: "Spoke & Chain", mark: "a small chainring mark",
        colors: { ground: "#1D3FA8", ink: "#FFFFFF", accent: "#C6F04A" }, type: "bold condensed sans", ...(viewport === "desktop" ? { nav: ["Repairs", "Bikes", "Workshop"] } : {}),
        cta: { label: "Book a repair", style: "filled", color: "#C6F04A" },
        layout: viewport === "desktop" ? [{ area: "left", pct: 46, content: "solid cobalt #1D3FA8 type field with the headline and the pill" }, { area: "right", pct: 54, content: "full-bleed photograph" }] : [{ area: "top", pct: 30, content: "photograph band under the top bar" }, { area: "bottom", pct: 70, content: "cobalt type field with the headline and the pill" }],
        lines: [{ role: "headline", text: "Wheels trued / while you wait." }, { role: "subline", text: "Repairs and servicing in Leipzig." }], accent: { words: "while you wait.", treatment: "in lime" },
        subject: "a crisp studio photograph of a vintage teal steel road bike on a truing stand, side view, overcast window light", prompt: "A brass spoke ruler under the headline." } });
      const stored = [];
      const storeComp = async (bytes, provenance) => { stored.push(provenance); return { id: `c0000000-0000-5000-a000-00000000000${stored.length}`, data: bytes }; };
      script.push({ content: [comp("k0", "top")] }, { content: [{ type: "tool_use", id: "c1", name: "concept", input }] },
        { content: [comp("k1", "top"), comp("k2", "rates"), comp("k3", "work"), comp("k4", "top", "mobile"), comp("k5", "visit"), comp("k6", "band"), comp("k7", "stories"), comp("k8", "faq")] },
        { content: [{ type: "tool_use", id: "r1", name: "read_comp", input: { section: "top", viewport: "desktop", headlineCapHeightPct: 9, imageAreaPct: 48, imageSide: "right" } }, { type: "tool_use", id: "r2", name: "read_comp", input: { section: "nowhere", viewport: "desktop", headlineCapHeightPct: 9, imageAreaPct: 48, imageSide: "right" } }, gen("g1", { name: "hero-bench" })] },
        { content: [...site("z"), finish("f1")] }, { content: [finish("f1b")] });
      const { result, events, files } = await run({ concept: true, storeComp });
      assert.ok(result.finished);
      assert.ok(seen[0].tools.includes("generate_comp"), "offered on a first build with a text-capable model");
      const early = events.find(event => event.type === "tool_error" && event.tool === "generate_comp");
      assert.match(early.message, /Record the concept/);
      const conceptResult = seen[2].messages.at(-1).content.find(block => block.type === "tool_result");
      assert.match(conceptResult.content, /Your next step is the design comps: in one response call generate_comp at least four times/, "the concept result makes the comps the next step");
      const results = seen[3].messages.at(-1).content.filter(block => block.type === "tool_result");
      const made = results.filter(block => Array.isArray(block.content));
      assert.ok(made.length >= 2 && made.length <= MAX_COMPS, `comps inside the image third (${made.length})`);
      const refused = results.filter(block => block.is_error);
      assert.ok(refused.length >= 1 && refused.every(block => /No image budget is left for another design comp|At most 6 design comps/.test(block.content)), "comps never take the photographs' share");
      const [image, text] = made[0].content;
      const size = await sharp(Buffer.from(image.source.data, "base64")).metadata();
      assert.equal(Math.max(size.width, size.height), 1024);
      assert.match(text.text, /never shown on the page or registered as a site image/); assert.match(text.text, /build the section to match the comp as closely as code allows/);
      assert.match(text.text, /rule wins over the comp/);
      assert.ok(stored.every(item => item.kind === "design-comp"));
      assert.ok(![...files.assets.keys()].some(key => /comp/.test(key)), "comps are not site images");
      // The reference pattern: brand, hex colours, nav, the pill, layout percentages, quoted lines with breaks, the accent, the tail; then the router's exact-text instruction.
      const desk = imageCalls.find(call => call.model === "gpt-image-2.5-flare" && /^The homepage of a website called "Spoke & Chain"/.test(call.prompt));
      assert.ok(desk, "comps go to the text model in the reference pattern");
      for (const part of [/cobalt blue background #1D3FA8/, /Top navigation: wordmark "Spoke & Chain" left with a small chainring mark; "Repairs", "Bikes", "Workshop" right of centre; a [a-z ]*lime pill "Book a repair" \(#C6F04A\) right\./, /Left 46%: solid cobalt #1D3FA8 type field/, /Right 54%: full-bleed photograph\./,
        /a huge bold condensed sans headline on two lines "Wheels trued" \/ "while you wait\." with "while you wait\." in lime/, /The photograph: a crisp studio photograph of a vintage teal steel road bike/, /Flat, straight-on, pixel-perfect screenshot of the homepage filling the entire 16:9 image edge to edge/, /no garbled letters, no lorem ipsum\./, /Render this text in the image, spelled exactly/])
        assert.match(desk.prompt, part);
      // 2560x1440 high is not measured yet: the measured 1536x1024 high canvas, cut to 16:9 (the prompt keeps the cut margins clear), with allowHigh.
      assert.equal(desk.quality, "high"); assert.equal(desk.size, "1536x1024"); assert.equal(desk.allowHigh, true);
      assert.match(desk.prompt, /The top 7\.8% and bottom 7\.8% of the canvas are cropped away/);
      const storedDesk = stored.find(item => item.viewport === "desktop");
      assert.deepEqual([storedDesk.quality, storedDesk.size, storedDesk.crop], ["high", "1536x1024", { left: 0, top: 80, width: 1536, height: 864 }]);
      const shot = made.find(block => block.content[0].source)?.content[0];
      const dims = await sharp(Buffer.from(shot.source.data, "base64")).metadata();
      assert.equal(Math.round(dims.width / dims.height * 100), Math.round(16 / 9 * 100), "the stored comp is 16:9");
      // The phone comp: no high canvas is measured for phones, so medium on the measured 1024x1536 canvas, cut to the 390x844 screen, with the first-screen rule.
      const phone = imageCalls.find(call => /^The first phone screen of the homepage/.test(call.prompt));
      if (phone) {
        assert.equal(phone.quality, "medium"); assert.equal(phone.size, "1024x1536");
        assert.match(phone.prompt, /left \d+(\.\d)?% and right \d+(\.\d)?% of the canvas are cropped away/);
        assert.match(phone.prompt, /one phone screen, 390 × 844 px: the top bar, the whole headline and the "Book a repair" pill sit fully inside it/);
        assert.match(phone.prompt, /Flat, straight-on, pixel-perfect screenshot of the phone screen/);
      }
      assert.ok(events.filter(event => event.type === "image_start" && event.comp).length === made.length);
      const recorded = compsFromSource(files.files.get("src/App.tsx"));
      assert.equal(recorded.length, made.length); assert.equal(recorded[0].section, "top"); assert.match(recorded[0].asset, /^c0000000-/);
      assert.deepEqual(recorded[0].reading, { section: "top", viewport: "desktop", headlineCapHeightPct: 9, imageAreaPct: 48, imageSide: "right" }, "the reading travels in the concept comment to the review");
      const readResults = seen[4].messages.at(-1).content.filter(block => block.type === "tool_result");
      assert.match(readResults[0].content, /largest headline's cap height at least 85% of 9% of the frame/);
      assert.match(readResults[1].content, /There is no desktop comp for "nowhere"/);
      assert.ok(events.some(event => event.type === "tool_error" && event.tool === "finish" && /Record read_comp for rates \(desktop\)/.test(event.message)), "unread comps are asked for once at finish");
      // A photograph asked for before any comp is sent back once to the comps; a repeat goes ahead.
      script.length = 0; seen.length = 0; imageCalls.length = 0;
      script.push({ content: [{ type: "tool_use", id: "c2", name: "concept", input }] }, { content: [gen("g7", { name: "hero-bench" })] }, { content: [gen("g8", { name: "hero-bench" })] }, { content: [...site("w"), finish("f9")] });
      const eager = await run({ concept: true, storeComp });
      assert.match(eager.events.find(event => event.type === "tool_error" && event.tool === "generate_image").message, /Design comps come first on this build/);
      assert.equal(imageCalls.length, 1, "the repeat is generated");
      // Edits never get the tool.
      script.length = 0; seen.length = 0;
      script.push({ content: [...site("e"), finish("f2")] });
      await run({ concept: false });
      assert.ok(!seen[0].tools.includes("generate_comp"));
    } finally { testModels = ["gpt-image-2"]; }
    // Without a text-capable model there are no comps.
    script.length = 0; seen.length = 0;
    script.push({ content: [...site("q"), finish("f3")] }, { content: [finish("f4")] });
    await run({ concept: true });
    assert.ok(!seen[0].tools.includes("generate_comp"));
    assert.match(compPrompt({ section: "top", viewport: "mobile", brand: "Spoke & Chain", colors: { ground: "#1D3FA8", ink: "#FFFFFF", accent: "#C6F04A" }, type: "bold condensed sans", cta: { label: "Book a repair", style: "filled", color: "#C6F04A" },
      layout: [{ area: "full", pct: 100, content: "photograph band then type" }], lines: [{ role: "headline", text: "Fixed by / Friday." }], subject: "a teal road bike" }, { chosen: { name: "Truing stand" }, artSystem: SITE_PLAN.artSystem }), /^The first phone screen of the homepage[\s\S]*Motif: a spoke ruler[\s\S]*screenshot of the phone screen/);
  });

  await check("comp-first: the review attaches the comps it can read (design comps of this project only) before the screenshots", async () => {
    const png = await picture(1536, 1024, { format: "png" });
    const app = conceptComment({ chosen: { name: "A", headline: "B c d", device: "e", archetype: "f", ground: "g", action: "h", angle: "i", scores: { memorable: 4, specific: 4, action: 4, buildable: 4 } }, runnersUp: [], why: "why it wins",
      comps: [{ section: "top", viewport: "desktop", asset: "c0000000-0000-5000-a000-000000000001" }, { section: "menu", viewport: "desktop", asset: "c0000000-0000-5000-a000-000000000002" }] }) + "\nexport default function App() { return null; }\n";
    const rows = { "c0000000-0000-5000-a000-000000000001": { object_path: "w/p/artwork/one.webp", provenance: { kind: "design-comp" } }, "c0000000-0000-5000-a000-000000000002": { object_path: "w/p/artwork/two.webp", provenance: { kind: "generated" } } };
    const client = { from: () => { const filters = {}; const query = { select: () => query, eq: (key, value) => { filters[key] = value; return query; }, maybeSingle: async () => ({ data: rows[filters.id] ?? null, error: null }) }; return query; } };
    const blocks = await designCompBlocks(client, { workspaceId: "w", projectId: "p" }, app, async () => ({ data: new Blob([png]), error: null }));
    assert.equal(blocks.length, 2, "one comp: a label and its image (the other row is not a design comp)");
    assert.match(blocks[0].text, /Design comp for the "top" section \(desktop\)/); assert.equal(blocks[1].type, "image");
    const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/build/route.ts"), "utf8");
    assert.match(route, /\[\.\.\.await designCompBlocks\(client, scope, files\.files\.get\("src\/App\.tsx"\)\), \.\.\.reviewAttachments\(reviewing\)\]/);
    assert.match(reviewRequest({ round: 1, screenshots: [], viewports: [], errors: ["x"] }), /7\. Fidelity to the design comps/);
    assert.match(BUILDER_SYSTEM, /DESIGN COMPS \(first builds, when generate_comp is offered\)/);
  });

  await check("token bounds stay correct with images in the history: images count by pixel size, not base64 bytes", async () => {
    const formats = [["webp", 1536, 1024], ["png", 640, 427], ["jpeg", 1024, 1536]];
    for (const [format, width, height] of formats) {
      const data = (await picture(width, height, { format })).toString("base64");
      assert.deepEqual(base64ImageSize(data), { width, height }, `${format} header size`);
    }
    // WebP variants: lossless (VP8L) and extended (VP8X with alpha).
    const lossless = await sharp(await picture(300, 200, { format: "png" })).webp({ lossless: true }).toBuffer();
    assert.deepEqual(base64ImageSize(lossless.toString("base64")), { width: 300, height: 200 });
    const alpha = await sharp({ create: { width: 321, height: 123, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).webp().toBuffer();
    assert.deepEqual(base64ImageSize(alpha.toString("base64")), { width: 321, height: 123 });
    const gif = await sharp(await picture(64, 48, { format: "png" })).gif().toBuffer();
    assert.deepEqual(base64ImageSize(gif.toString("base64")), { width: 64, height: 48 });

    const preview = await imagePreview(await picture(1536, 1024));
    const block = { type: "image", source: { type: "base64", media_type: preview.mediaType, data: preview.data } };
    const billed = Math.ceil(preview.width * preview.height / 750);
    const bound = imageTokenBound(block.source);
    assert.ok(bound >= billed, `bound ${bound} covers the billed ~${billed} tokens`);
    assert.ok(bound < 1000, "and stays tight (under 1k for a 768 px preview)");
    // A tiny file for a huge picture: the old byte count would have under-counted it.
    const flat = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: "#777" } }).gif().toBuffer();
    const flatSource = { type: "base64", data: flat.toString("base64") };
    assert.ok(flatSource.data.length < 2400 * 1600 / 750, "fixture: fewer base64 bytes than image tokens");
    assert.ok(imageTokenBound(flatSource) >= Math.min(4784, Math.ceil(2400 * 1600 / 750)), "counted by pixels");
    assert.equal(imageTokenBound({ type: "base64", data: Buffer.from("garbage").toString("base64") }), IMAGE_TOKENS_UNKNOWN);
    assert.equal(imageTokenBound({ type: "url", url: "https://example.com/a.png" }), IMAGE_TOKENS_UNKNOWN);

    const text = "Image ready. Use src=\"/images/hero.webp\" width=\"1536\" height=\"1024\" (photo, landscape).";
    const message = { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [block, { type: "text", text }] }] };
    const messageBound = messageTokenBound(message);
    assert.ok(messageBound >= billed + text.length, "covers the image and every text byte");
    assert.ok(messageBound < Buffer.byteLength(JSON.stringify(message)) / 10, "far below the base64 byte count");
    assert.equal(messageTokenBound({ role: "user", content: "plain" }), Buffer.byteLength(JSON.stringify({ role: "user", content: "plain" })) + 64, "text-only messages are unchanged");

    // The meter: after a reply, appended image results are bounded by pixel size on top of the confirmed usage.
    const meter = new ContextMeter(async () => 1000);
    const history = [{ role: "user", content: "Build it." }];
    assert.equal(await meter.bound(history), Math.ceil(1000 * 1.02) + 512);
    history.push({ role: "assistant", content: [{ type: "text", text: "ok" }] });
    meter.afterReply({ input_tokens: 1000, output_tokens: 200 }, history);
    history.push(message);
    assert.equal(await meter.bound(history), Math.ceil(1200 * 1.05) + 512 + messageBound);
  });

  console.log(`\n${passed} image vision checks passed (scripted providers, no network).`);
})().catch(error => { console.error(error); process.exit(1); });
