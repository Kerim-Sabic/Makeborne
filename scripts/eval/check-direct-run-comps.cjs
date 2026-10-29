/* eslint-disable @typescript-eslint/no-require-imports -- Offline: a direct-run first build (as scripts/eval/direct-run.mjs sets it up) is offered the concept step and the design comps. Fake providers, no network, no spend. Run: node scripts/eval/check-direct-run-comps.cjs */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { loadApp } = require("./lib/app-modules.cjs");

(async () => {
  // direct-run.mjs: images on with the text-capable 2.5 models, the 0.03 rate, no other image model.
  Object.assign(process.env, { ANTHROPIC_API_KEY: "offline-not-sent", OPENAI_API_KEY: "offline-not-sent", MAKEBORNE_AI_COST_USD_PER_CREDIT: "0.03", MAKEBORNE_BUILDER_FALLBACK_MODELS: "", MAKEBORNE_IMAGE_MODEL: "", MAKEBORNE_IMAGE_MODELS: "gpt-image-2.5-sunburst,gpt-image-2.5-flare", MAKEBORNE_DESIGN_COMPS: "on" });
  delete process.env.MAKEBORNE_BUILDER_MODEL;
  const { runBuilder } = loadApp("src/lib/builder/agent.ts");
  const { ProjectFiles } = loadApp("src/lib/builder/files.ts");
  const { RunSpend, memoryGate } = loadApp("src/lib/ai/run-spend.ts");
  const { BUILDER_EFFORT } = loadApp("src/lib/builder/pricing.ts");
  const source = fs.readFileSync(path.join(__dirname, "direct-run.mjs"), "utf8");
  assert.match(source, /concept: name === 'build' && !files\.files\.size/, "direct-run asks for the concept step on the first build");
  assert.match(source, /MAKEBORNE_DESIGN_COMPS: 'on'/, "direct-run turns the app's design-comps switch on");
  for (const effort of ["medium", "high"]) {
    const seen = [];
    const anthropic = { beta: { messages: {
      async countTokens() { return { input_tokens: 4000 }; },
      stream(params) { seen.push((params.tools ?? []).map(tool => tool.name)); throw Object.assign(new Error("offline probe: no provider call"), { code: "PROBE" }); },
    } } };
    const cap = Math.round(BUILDER_EFFORT[effort].ceilingCredits * 0.03 * 1e6);
    const spend = new RunSpend({ run: `probe-${effort}`, providerCapMicrousd: cap, customerCapMicrousd: null, gate: memoryGate(), deadline: Date.now() + 60_000 });
    await runBuilder({ client: null, scope: { workspaceId: "eval", projectId: "probe" }, files: new ProjectFiles(), effort, spend, request: "A website for a bike repair shop in Leipzig.", context: "<project title=\"Spoke\">Brief: bikes</project>",
      concept: true, attachments: [], emit: () => {}, signal: new AbortController().signal, deadline: Date.now() + 60_000, anthropic, imageClient: { images: { async generate() { throw new Error("no image call in the probe"); } } }, storeImage: async () => { throw new Error("no store"); } }).catch(() => undefined);
    assert.ok(seen.length >= 1, "the first step reached the (fake) provider");
    for (const tool of ["concept", "generate_comp", "read_comp", "generate_image"]) assert.ok(seen[0].includes(tool), `${effort}: ${tool} is offered on the first build (${seen[0].join(", ")})`);
    console.log(`PASS ${effort}: the first build is offered ${seen[0].filter(name => /concept|comp|image/.test(name)).join(", ")}`);
  }
})().catch(error => { console.error(error); process.exit(1); });
