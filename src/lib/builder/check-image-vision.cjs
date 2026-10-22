/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for vision-checked images: the builder sees every generated image, regenerates a rejected slot at most once, the review may regenerate one image (never on type-only designs), the image plan, and the token bounds with images in the history. No network. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict"), Module = require("node:module");
const sharp = require("sharp");
const load = Module._load, script = [], seen = [];
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
  if (name === "./images" && fromAgent) return { imageConfiguration: () => ({ model: "gpt-image-2", models: ["gpt-image-2"], issue: null }), IMAGE_SIZES: { landscape: "1536x1024", portrait: "1024x1536", square: "1024x1024" }, openaiImageClient: () => ({}) };
  // The image provider: every call returns the fixture picture; nothing is sent anywhere.
  if (name === "../ai/image-call" && fromAgent) return { startBudgetedImage: async input => {
    imageCalls.push(input);
    return { done: Promise.resolve(imageBytes), detail: Promise.resolve({ model: input.model, quality: input.quality, size: input.size, boundMicrousd: 1, costMicrousd: 42_000, outputTokens: 1000, boundOutputTokens: 2000, overrun: false }) };
  } };
  return load.call(this, name, parent, main);
};
const imageCalls = [];
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);

const { runBuilder, regenerationProblem, imageReadyMessage, IMAGE_INSPECTION } = require("./agent.ts");
const { ProjectFiles } = require("./files.ts");
const { checkConcept, imagePlanNote, CONCEPT_TOOL } = require("./concept.ts");
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
    assert.match(text.text, /malformed hands/); assert.match(text.text, /gibberish lettering/); assert.match(text.text, /plastic skin/); assert.match(text.text, /wrong subject/); assert.match(text.text, /house style and palette/);
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
    files.addAsset({ id: "00000001-0000-5000-a000-000000000000", path: "public/images/hero-bench.webp", sha256: "a".repeat(64), bytes: 1000, mediaType: "image/webp" });
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
    assert.match(rubric, /5\. Imagery/); assert.match(rubric, /reads as AI-made/); assert.match(rubric, /a bad crop/); assert.match(rubric, /fighting its text/); assert.match(rubric, /placed without purpose/);
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
    assert.match(note, /2 images/); assert.ok(note.includes(plan.houseStyle)); assert.match(note, /inspect each image/);
  });

  await check("the concept with an image plan reaches the model and the run events", async () => {
    script.length = 0; seen.length = 0;
    const concept = (name, headline, device) => ({ name, headline, angle: `An angle for ${name}`, device, archetype: "Editorial split", ground: "a workshop green", action: "book a repair", scores: { memorable: 4, specific: 4, action: 4, buildable: 4 } });
    const input = { concepts: [concept("Truing stand", "Wheels trued while you wait", "a spoke-tension gauge"), concept("Repair ticket", "Your bike, ticketed", "a numbered repair ticket")], chosen: 0, why: "The gauge is the craft.",
      imagePlan: { houseStyle: "One documentary photographer, one overcast morning, 35mm, muted greens and brass.", shots: [{ section: "hero", job: "Show the craft of truing a wheel", shot: "close detail", aspect: "landscape", focal: "hands left; calm right", layout: "editorial split" }] } };
    script.push({ content: [{ type: "tool_use", id: "c1", name: "concept", input }, ...site("v")] }, { content: [gen("g1", { name: "hero-bench" })] }, { content: [finish("f6")] });
    const { events } = await run({ concept: true });
    assert.equal(events.find(event => event.type === "concept").shots, 1);
    const recorded = seen[1].messages.at(-1).content.find(block => block.type === "tool_result" && /Concept recorded/.test(block.content));
    assert.match(recorded.content, /Image plan recorded \(1 image\)/);
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
