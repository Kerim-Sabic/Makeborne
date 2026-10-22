import "server-only";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaContentBlockParam, BetaMessageParam, BetaRawMessageStreamEvent, BetaToolResultBlockParam, BetaToolUnion, BetaToolUseBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { EffortLevel } from "../routing/effort";
import { WebsiteDesignDirectionSchema } from "../projects/website-source";
import { FileToolError, ProjectFiles } from "./files";
import { compileVerdict, type CompileVerdict } from "./compile";
import { IMAGE_SIZES, imageConfiguration, openaiImageClient, storeGeneratedImage, type GeneratedImageRequest } from "./images";
import responsive from "../../../infra/project-runtime/responsive-images.cjs";
import { BUILDER_EFFORT, aiCostUsdPerCredit } from "./pricing";
import { ContextMeter, budgetedStream, builderModels, type AnthropicLike } from "../ai/anthropic-call";
import { startBudgetedImage, type ImageClientLike } from "../ai/image-call";
import { UnpricedModelError, imageCallBoundMicrousd, supportsTransparentImages } from "../ai/prices";
import { IMAGE_KINDS, TEXT_IMAGE_MODELS, routeImage } from "./image-router";
import { SpendError, type RunSpend } from "../ai/run-spend";
import { BUILDER_SYSTEM } from "./prompt";
import { qualityProblems, type QualityInput } from "./quality-gates";
import { CONCEPT_TOOL, checkConcept, withConceptComment, type ConceptRecord } from "./concept";

/** Conservative streaming output rate used to size steps to the time left. */
const OUTPUT_TOKENS_PER_SECOND = 50;
/** Smallest output allowance worth a builder step. */
export const MIN_STEP_TOKENS = 2_048;

export const builderModel = () => process.env.MAKEBORNE_BUILDER_MODEL || "claude-opus-5-5";

export type BuilderEvent =
  | { type: "status"; message: string }
  | { type: "text"; delta: string }
  | { type: "progress"; delta: string }
  | { type: "file_start"; path: string; op: "write" | "edit" | "delete" }
  | { type: "file"; path: string; op: "write" | "edit"; content: string }
  | { type: "delete"; path: string }
  | { type: "image_start"; name: string; prompt: string }
  | { type: "image"; path: string; url: string; assetId: string; model?: string; quality?: string; size?: string; reason?: string; costMicrousd?: number | null }
  | { type: "tool_error"; tool: string; message: string }
  | { type: "usage"; credits: number }
  | { type: "concept"; chosen: string; runnersUp: string[]; why: string }
  | { type: "done"; version: number; summary: string; charged: number; changed?: boolean; finished?: boolean; build?: "passed" | "unverified" | null }
  | { type: "error"; code: string; message: string; retryable?: boolean };

const name = z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Use a short kebab-case name like hero-portrait.");
const ToolInputs = {
  write_file: z.object({ path: z.string(), content: z.string() }).strict(),
  edit_file: z.object({ path: z.string(), old_string: z.string(), new_string: z.string(), replace_all: z.boolean().optional() }).strict(),
  delete_file: z.object({ path: z.string() }).strict(),
  generate_image: z.object({ name, prompt: z.string().min(20).max(3000), aspect: z.enum(["landscape", "portrait", "square"]), kind: z.enum(IMAGE_KINDS).optional(),
    text: z.string().max(200).nullable().optional(), textPlacement: z.enum(["exact", "loose"]).optional() }).strict(),
  finish: z.object({
    summary: z.string().min(1).max(2000),
    title: z.string().min(1).max(200).optional(),
    routes: z.array(z.object({ path: z.string().regex(/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/), title: z.string().min(1).max(200) }).strict()).max(50).optional(),
    design: WebsiteDesignDirectionSchema.optional(),
  }).strict(),
};

function tools(images: boolean, cutouts = false, textImages = false, concept = false): BetaToolUnion[] {
  const list: BetaToolUnion[] = [
    ...(concept ? [CONCEPT_TOOL as unknown as BetaToolUnion] : []),
    { name: "write_file", description: "Create a new file or replace an entire file in the project.", eager_input_streaming: true,
      input_schema: { type: "object", properties: { path: { type: "string", description: "Relative path, e.g. src/components/Hero.tsx" }, content: { type: "string", description: "Complete file content" } }, required: ["path", "content"], additionalProperties: false } },
    { name: "edit_file", description: "Replace an exact string in an existing file. old_string must match the current file exactly (including whitespace) and be unique unless replace_all is true.", eager_input_streaming: true,
      input_schema: { type: "object", properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" } }, required: ["path", "old_string", "new_string"], additionalProperties: false } },
    { name: "delete_file", description: "Delete a file that is no longer used.",
      input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } },
    { name: "finish", description: "Call once the website is complete and checked. Provide a short, friendly summary of what you built or changed (2-4 sentences, no code), the site title (the brand or business name, used as the page title), and optionally the list of page routes and the design direction.",
      input_schema: { type: "object", properties: {
        summary: { type: "string" }, title: { type: "string" },
        routes: { type: "array", items: { type: "object", properties: { path: { type: "string" }, title: { type: "string" } }, required: ["path", "title"], additionalProperties: false } },
        design: { type: "object", properties: { positioning: { type: "string" }, composition: { type: "string" }, typography: { type: "string" }, palette: { type: "string" }, imagery: { type: "string" }, motion: { type: "string" } }, required: ["positioning", "composition", "typography", "palette", "imagery", "motion"], additionalProperties: false },
      }, required: ["summary", "title"], additionalProperties: false } },
  ];
  if (images) list.splice(3, 0, { name: "generate_image", description: `Generate one original, art-directed image for the website and register it in the project. Returns the URL and pixel size to use in code (e.g. /images/hero-portrait.webp, width 1536, height 1024). Write a precise visual prompt: subject, composition, lighting or medium, palette, mood, then the house style. Never request text, logos or watermarks in images. kind: photo (default), illustration, texture, icon, or cutout: one subject on a transparent background, trimmed to the subject, for layering over colour fields, shapes or other images${cutouts ? "" : " (cut-outs are unavailable with the configured image models)"}. text: null for no words in the image (the default, and the right choice when the words can be HTML over the image); otherwise the exact short words the image itself must show (a sign, label or poster lettering), with textPlacement "exact" when they must sit precisely where the prompt says${textImages ? "" : " (text in images is unavailable with the configured image models: use HTML text)"}. The platform picks the image model and quality per image.`,
    input_schema: { type: "object", properties: { name: { type: "string", description: "kebab-case file name without extension" }, prompt: { type: "string" }, aspect: { type: "string", enum: ["landscape", "portrait", "square"] }, kind: { type: "string", enum: [...IMAGE_KINDS] }, text: { type: ["string", "null"], description: "Exact words to render in the image, or null" }, textPlacement: { type: "string", enum: ["exact", "loose"] } }, required: ["name", "prompt", "aspect"], additionalProperties: false } });
  return list;
}

export type BuilderRun = {
  client: SupabaseClient;
  scope: { workspaceId: string; projectId: string };
  files: ProjectFiles;
  effort: EffortLevel;
  /** Provider and customer limits for this run; every call is bounded against it. */
  spend: RunSpend;
  request: string;
  context: string;
  attachments: BetaContentBlockParam[];
  emit: (event: BuilderEvent) => void;
  signal: AbortSignal;
  /** Epoch ms by which the run must have stopped (platform time limit). */
  deadline: number;
  /** Tighter limits for focused passes such as the design review. */
  limits?: { maxTurns?: number; maxImages?: number };
  /** Completeness: sections the approved brief lists (by anchor) and the client's must-haves; checked at finish. */
  required?: QualityInput["required"];
  /** First build of a website: record 2-3 concepts with the concept tool and build the strongest. */
  concept?: boolean;
  /** Rendered contrast at finish (text over its real background): failing pairs, or null when no browser is available. */
  contrastCheck?: (files: ReadonlyMap<string, string>) => Promise<readonly string[] | null>;
  /** No step starts with less time than this left (default 45 s; tests use less). */
  stepGuardMs?: number;
  /** Injected providers (tests). Production uses the SDKs with retries disabled. */
  anthropic?: AnthropicLike;
  imageClient?: ImageClientLike;
  storeImage?: (request: GeneratedImageRequest, bytes: Buffer) => ReturnType<typeof storeGeneratedImage>;
  /** Compile check at finish (tests inject one); production bundles with esbuild. */
  compile?: (files: ReadonlyMap<string, string>) => Promise<CompileVerdict>;
  /** The model this stage runs on (see ../ai/model-routing.ts); default: the builder model. */
  model?: string;
};

/** credits: customer-chargeable usage (confirmed cost); usd: provider cost incl. unconfirmed bounds.
 * build: the finish-time compile verdict when the run finished, null otherwise. */
export type BuilderResult = { summary: string; title?: string; credits: number; usd: number; finished: boolean; build: "passed" | "unverified" | null; stopped: string | null; concept?: ConceptRecord | null };

/** Agentic edit loop: Claude edits the in-memory project through tools until it
 * calls finish with a project that passes static checks and compiles, or the budget runs out. */
export async function runBuilder(run: BuilderRun): Promise<BuilderResult> {
  const policy = { ...BUILDER_EFFORT[run.effort], ...run.limits };
  const model = run.model ?? builderModel();
  const models = builderModels(model);
  const anthropic = run.anthropic ?? (new Anthropic({ maxRetries: 0, timeout: 600_000 }) as unknown as AnthropicLike);
  const rate = aiCostUsdPerCredit();
  const spend = run.spend;
  // The configured image model, or null when images are off (see imageConfiguration).
  // The routable image models (ordered allowlist), or none when images are off (see imageConfiguration).
  const imageModels = policy.maxImages > 0 ? imageConfiguration().models ?? [] : [];
  const imageModelId = imageModels[0] ?? null;
  // One image's worst case; images may use at most a third of the run's allowance.
  // Sizing the run's image allowance: the dearest allowed model at medium portrait with a full prompt.
  const imageBound = imageModels.length ? Math.max(...imageModels.map(model => imageCallBoundMicrousd(model, "medium", IMAGE_SIZES.portrait, "x".repeat(3400)))) : Infinity;
  const imageLimit = imageModelId ? Math.min(policy.maxImages, Math.floor(spend.allowanceMicrousd / imageBound / 3)) : 0;
  const imageClient = imageModelId && imageLimit > 0 ? run.imageClient ?? openaiImageClient() : null;
  // Website images also get responsive copies (srcset) while they fit the site's image budget.
  const storeImage = run.storeImage ?? ((request: GeneratedImageRequest, bytes: Buffer) => storeGeneratedImage(run.client, run.scope, request, bytes,
    { variants: added => responsive.variantsFit([...run.files.assets.values()], added) }));
  const cutouts = imageModels.some(supportsTransparentImages);
  const textImages = imageModels.some(model => TEXT_IMAGE_MODELS.includes(model));
  let imagesUsed = 0, summary = "", title: string | undefined, finished = false, malformedTurns = 0;
  let concept: ConceptRecord | null = null;
  // Quality gates block a finish once per distinct problem; a repeat is accepted, so a false positive can never strand the work.
  const qualityReported = new Set<string>();
  let build: BuilderResult["build"] = null;
  const system = [{ type: "text" as const, text: BUILDER_SYSTEM }];
  const toolList = tools(imageLimit > 0, cutouts, textImages, Boolean(run.concept));
  const meter = new ContextMeter(async messages => (await anthropic.beta.messages.countTokens({ model, system, tools: toolList, messages }, { signal: run.signal, maxRetries: 0, timeout: Math.max(1, Math.min(30_000, spend.timeLeftMs())) })).input_tokens);
  const usage = () => run.emit({ type: "usage", credits: spend.customerCredits(rate) });

  const messages: BetaMessageParam[] = [{ role: "user", content: [
    ...run.attachments,
    { type: "text", text: `${run.context}\n\nImage generation: ${imageLimit > 0 ? `available (up to ${imageLimit} images this run${cutouts ? ", transparent cut-outs included" : "; transparent cut-outs unavailable"})` : "unavailable — use typography, CSS and inline SVG"}.\n\n<request>\n${run.request}\n</request>` },
  ] }];

  for (let turn = 0; turn < policy.maxTurns && !finished; turn++) {
    // Never start a step that cannot finish before the platform limit or the hold's end.
    const deadline = Math.min(run.deadline, spend.deadline);
    if (run.signal.aborted || Date.now() > deadline - (run.stepGuardMs ?? 45_000)) break;
    // Size each step to the time left so it ends (and its files are kept)
    // before the limit, instead of being cut off mid-response.
    const secondsLeft = (deadline - Date.now()) / 1000 - 25;
    const turnTokens = Math.min(policy.maxTokens, Math.max(8_000, Math.floor(secondsLeft * OUTPUT_TOKENS_PER_SECOND)));

    const announced = new Set<number>();
    const partial = new Map<number, { name: string; json: string }>();
    const onEvent = (event: BetaRawMessageStreamEvent) => {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") partial.set(event.index, { name: event.content_block.name, json: "" });
      if (event.type === "content_block_stop") {
        // Keep and show each finished file immediately, so work survives a step
        // that is cut off later. Writes are idempotent: the tool call re-applies
        // it (and reports problems) when the turn completes.
        const block = partial.get(event.index);
        partial.delete(event.index);
        if (block?.name !== "write_file") return;
        try {
          const input = ToolInputs.write_file.parse(JSON.parse(block.json));
          run.files.write(input.path, input.content);
          run.emit({ type: "file", path: input.path, op: "write", content: input.content });
        } catch { /* invalid input is reported when the tool runs */ }
        return;
      }
      if (event.type !== "content_block_delta") return;
      if (event.delta.type === "text_delta") run.emit({ type: "text", delta: event.delta.text });
      else if (event.delta.type === "thinking_delta" && event.delta.thinking) run.emit({ type: "progress", delta: event.delta.thinking });
      else if (event.delta.type === "input_json_delta") {
        const block = partial.get(event.index);
        if (!block) return;
        block.json += event.delta.partial_json;
        if (announced.has(event.index)) return;
        const path = /"path"\s*:\s*"([^"]+)"/.exec(block.json.slice(0, 600))?.[1];
        if (path) { announced.add(event.index); run.emit({ type: "file_start", path, op: block.name === "edit_file" ? "edit" : "write" }); }
      }
    };

    let message;
    try {
      ({ message } = await budgetedStream({ client: anthropic, spend, meter, models, maxTokens: turnTokens, minTokens: MIN_STEP_TOKENS, signal: run.signal, onEvent,
        // First make a recoverable project. Unbounded first-turn deliberation
        // can consume the entire request without producing a single file.
        // Later refinement retains the user's requested reasoning intensity.
        params: { betas: ["thinking-display-updates-2026-08-18"], thinking: { type: "adaptive", display: "updates" }, output_config: { effort: run.files.files.size === 0 ? "low" : policy.intensity },
          cache_control: { type: "ephemeral" }, system, tools: toolList, messages } }));
    } catch (error) {
      usage();
      // Budget or hold time used up: stop and keep the work finished so far.
      if (error instanceof SpendError && error.graceful) break;
      if (isProviderOrSpendError(error) || run.signal.aborted || ++malformedTurns > 2) throw error;
      // A tool input that could not be parsed: the turn never completed, so re-issue it (same budget).
      run.emit({ type: "status", message: "Retrying an incomplete step…" });
      continue;
    }
    malformedTurns = 0;
    usage();
    const content = message.content as BetaContentBlock[];
    messages.push({ role: "assistant", content: content as BetaContentBlockParam[] });
    meter.afterReply(message.usage, messages);

    if (message.stop_reason === "refusal") throw Object.assign(new Error("The request was declined by the model's safety policy."), { code: "REFUSED" });
    const uses = content.filter((block): block is BetaToolUseBlock => block.type === "tool_use");
    if (!uses.length) {
      if (message.stop_reason === "end_turn") {
        messages.push({ role: "user", content: "Continue. When the website is complete and checked, call finish." });
        continue;
      }
      break;
    }

    // On the output limit only the block being written last is incomplete.
    const last = content.at(-1);
    const incomplete = message.stop_reason === "max_tokens" && last?.type === "tool_use" ? last.id : null;
    const results: BetaToolResultBlockParam[] = [];
    const imageJobs: Promise<void>[] = [];
    for (const use of uses) {
      const fail = (text: string) => { results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: text }); run.emit({ type: "tool_error", tool: use.name, message: text }); };
      if (use.id === incomplete) { fail("Your response hit the output limit before this tool call completed; the calls before it were applied. Continue with this file, writing one or two files per step."); continue; }
      try {
        switch (use.name) {
          case "write_file": {
            const input = ToolInputs.write_file.parse(use.input);
            run.files.write(input.path, input.content);
            run.emit({ type: "file", path: input.path, op: "write", content: input.content });
            results.push({ type: "tool_result", tool_use_id: use.id, content: `Wrote ${input.path}.` });
            break;
          }
          case "edit_file": {
            const input = ToolInputs.edit_file.parse(use.input);
            run.emit({ type: "file_start", path: input.path, op: "edit" });
            run.files.edit(input.path, input.old_string, input.new_string, input.replace_all);
            run.emit({ type: "file", path: input.path, op: "edit", content: run.files.files.get(input.path)! });
            results.push({ type: "tool_result", tool_use_id: use.id, content: `Edited ${input.path}.` });
            break;
          }
          case "delete_file": {
            const input = ToolInputs.delete_file.parse(use.input);
            run.files.remove(input.path);
            run.emit({ type: "delete", path: input.path });
            results.push({ type: "tool_result", tool_use_id: use.id, content: `Deleted ${input.path}.` });
            break;
          }
          case "generate_image": {
            const input = ToolInputs.generate_image.parse(use.input);
            if (!imageClient || !imageModelId) { fail("Image generation is unavailable. Use CSS, typography and inline SVG."); break; }
            if (imagesUsed >= imageLimit || spend.remainingMicrousd - imageBound < spend.allowanceMicrousd * 0.1) { fail("Image budget for this run is used up. Reuse existing images or use CSS/SVG artwork."); break; }
            if (run.files.assets.has(`public/images/${input.name}.webp`)) { fail(`An image named ${input.name} already exists at /images/${input.name}.webp. Reuse it or choose a new name.`); break; }
            const kind = input.kind ?? "photo";
            const route = routeImage({ kind, aspect: input.aspect, text: input.text ?? null, textPlacement: input.textPlacement }, input.prompt, imageModels);
            if (!route.ok) { fail(route.error); break; }
            if (spend.remainingMicrousd - route.boundMicrousd < spend.allowanceMicrousd * 0.1) { fail("Image budget for this run is used up. Reuse existing images or use CSS/SVG artwork."); break; }
            let job: Awaited<ReturnType<typeof startBudgetedImage>>;
            try {
              // The image's bound is reserved before the provider is contacted.
              job = await startBudgetedImage({ client: imageClient, spend, model: route.model, prompt: route.prompt, size: route.size, quality: route.quality, signal: run.signal, allowHigh: route.allowHigh,
                ...(route.background === "transparent" ? { background: "transparent" as const } : {}) });
            } catch (error) {
              fail(error instanceof SpendError && !error.graceful ? `${error.message} Continue without this image (use CSS/SVG artwork).` : "Image budget for this run is used up. Reuse existing images or use CSS/SVG artwork.");
              break;
            }
            imagesUsed++;
            run.emit({ type: "image_start", name: input.name, prompt: input.prompt });
            const started = job;
            imageJobs.push(started.done.then(async bytes => {
              const detail = await started.detail;
              const record = { model: route.model, quality: route.quality, size: route.size, reason: route.reason, text: input.text ?? null, costMicrousd: detail.costMicrousd, outputTokens: detail.outputTokens, overrun: detail.overrun };
              const asset = await storeImage({ name: input.name, prompt: route.prompt, model: route.model, kind, transparent: route.background === "transparent", route: record }, bytes);
              return { asset, record };
            }).then(({ asset, record }) => {
              run.files.addAsset({ id: asset.id, path: asset.path, sha256: asset.sha256, bytes: asset.bytes, mediaType: asset.mediaType });
              // Parallel jobs checked the budget before storing; re-check against what is registered now.
              if (asset.variants?.length && responsive.variantsFit([...run.files.assets.values()], asset.variants)) for (const variant of asset.variants) run.files.addAsset(variant);
              run.emit({ type: "image", path: asset.path, url: asset.url, assetId: asset.id, model: record.model, quality: record.quality, size: record.size, reason: record.reason, costMicrousd: record.costMicrousd });
              results.push({ type: "tool_result", tool_use_id: use.id, content: imageReadyMessage(asset, input.aspect, kind) });
            }, () => fail("Image generation failed. Continue without this image (use CSS/SVG artwork instead).")));
            break;
          }
          case "concept": {
            if (!run.concept) { fail("The concept step is only for a first build; continue with the current design."); break; }
            const checked = checkConcept(use.input);
            if (!checked.ok) { fail(checked.problem); break; }
            concept = checked.record;
            run.emit({ type: "concept", chosen: concept.chosen.name, runnersUp: concept.runnersUp.map(item => item.name), why: concept.why });
            results.push({ type: "tool_result", tool_use_id: use.id, content: `Concept recorded. Build only "${concept.chosen.name}": ${concept.chosen.headline} — signature device: ${concept.chosen.device}. Put the device on the first screen and carry it through the sections; it must serve the primary action (${concept.chosen.action}).` });
            break;
          }
          case "finish": {
            const input = ToolInputs.finish.parse(use.input);
            const problems = run.files.problems();
            // A finish sent alongside a failed edit would save the project without that change (and claim it was made).
            const failedTools = results.filter(result => result.is_error).length;
            if (failedTools) problems.unshift(`${failedTools === 1 ? "A tool call" : `${failedTools} tool calls`} in this step failed, so ${failedTools === 1 ? "that change was" : "those changes were"} not applied. Fix ${failedTools === 1 ? "it" : "them"} using the tool results, check the result, then call finish again.`);
            // A first build records its concepts before it can finish (once: a repeat is accepted).
            const noConcept = "Before finishing a first build, call the concept tool once with 2-3 genuinely distinct concepts, scored on the rubric, and keep building the strongest.";
            if (run.concept && !concept && !qualityReported.has(noConcept)) { qualityReported.add(noConcept); problems.push(noConcept); }
            if (input.routes?.length) run.files.routes = input.routes.some(route => route.path === "/") ? input.routes : [{ path: "/", title: "Home" }, ...input.routes];
            if (input.design) run.files.design = input.design;
            if (!problems.length) for (const problem of qualityProblems({ files: run.files.files, changed: run.files.changed, routes: run.files.routes, required: run.required })) {
              if (!qualityReported.has(problem)) { qualityReported.add(problem); problems.push(problem); }
            }
            if (!problems.length) { try { run.files.toSource(); } catch (error) { problems.push((error as Error).message); } }
            // A saved version must build: compile once the static checks pass.
            let verdict: CompileVerdict | null = null;
            if (!problems.length) {
              run.emit({ type: "status", message: "Checking that the website builds…" });
              verdict = await (run.compile ?? compileVerdict)(run.files.files);
              if (verdict.status === "failed") problems.push(...verdict.problems);
            }
            // Rendered contrast: text measured over its real background in a browser. Each failing pair blocks once.
            if (!problems.length && verdict?.status === "passed" && run.contrastCheck) {
              run.emit({ type: "status", message: "Checking text contrast…" });
              const findings = await run.contrastCheck(run.files.files).catch(() => null);
              for (const finding of findings ?? []) if (!qualityReported.has(finding)) { qualityReported.add(finding); problems.push(finding); }
            }
            if (problems.length) { fail(`Not finished yet. Fix these problems, then call finish again:\n- ${problems.join("\n- ")}`); break; }
            // An unavailable compiler is not the model's to fix: keep the work and report it as unverified.
            if (verdict?.status === "unverified") run.emit({ type: "status", message: "The build check could not run. Saving this version as not yet verified…" });
            summary = input.summary; title = input.title; finished = true; build = verdict?.status === "passed" ? "passed" : "unverified";
            results.push({ type: "tool_result", tool_use_id: use.id, content: "Saved." });
            break;
          }
          default: fail(`Unknown tool ${use.name}.`);
        }
      } catch (error) {
        fail(error instanceof FileToolError ? error.message : error instanceof z.ZodError ? `Invalid ${use.name} input: ${error.issues[0]?.message ?? "check the parameters"}.` : `${use.name} failed.`);
      }
    }
    await Promise.all(imageJobs);
    usage();
    const order = new Map(uses.map((use, index) => [use.id, index]));
    results.sort((a, b) => order.get(a.tool_use_id)! - order.get(b.tool_use_id)!);
    if (finished) break;
    messages.push({ role: "user", content: results });
    if (spend.stopped || spend.remainingMicrousd <= 0) break;
    // A first build that has scaffolding and styles but still no page cannot be saved at all if the
    // step ends now (an eval brief lost a whole stage this way): the page itself comes next.
    if (turn >= 1 && run.files.files.size > 0 && !run.files.files.has("src/App.tsx") && /from\s+["']\.\/App["']/.test(run.files.files.get("src/main.tsx") ?? "")) {
      messages.push({ role: "system", content: "src/App.tsx does not exist yet, so nothing can be saved. Write src/App.tsx next (the complete page with every section and real copy, in one file if need be) before any other file or refinement." });
    }
    if (spend.remainingMicrousd < spend.allowanceMicrousd * 0.25 || turn === policy.maxTurns - 2 || Date.now() > deadline - 120_000) {
      messages.push({ role: "system", content: "Budget or time is nearly used up. Finish the most important remaining work in this step and call finish now." });
    }
  }
  // The chosen concept and its runners-up stay in the source (also for a continuation, which reads the files).
  const app = run.files.files.get("src/App.tsx");
  if (concept && app !== undefined) {
    const commented = withConceptComment(app, concept);
    if (commented !== app) { run.files.write("src/App.tsx", commented); run.emit({ type: "file", path: "src/App.tsx", op: "write", content: commented }); }
  }
  return { summary, title, credits: spend.customerCredits(rate), usd: spend.providerMicrousd / 1e6, finished, build, stopped: spend.stopped, concept };
}

/** Tool result for a stored image: the URL, its real pixel size (for width/height, so nothing shifts) and, for cut-outs, whether the alpha survived. */
export function imageReadyMessage(asset: { url: string; width?: number; height?: number; transparent?: boolean }, aspect: string, kind: string) {
  const size = asset.width && asset.height ? ` width="${asset.width}" height="${asset.height}"` : "";
  const note = kind === "cutout"
    ? (asset.transparent ? " Transparent cut-out trimmed to the subject: layer it over a colour field, shape or image; do not put it in a boxed card." : " The image came back opaque: frame it like a photo on a matching background.")
    : "";
  return `Image ready. Use src="${asset.url}"${size} (${kind}, ${aspect}).${note}`;
}

/** Provider HTTP errors and spending-control errors end the run; only malformed streams are retried as a turn. */
export function isProviderOrSpendError(error: unknown) {
  return error instanceof Anthropic.APIError || error instanceof SpendError || error instanceof UnpricedModelError
    || (error as { code?: unknown } | null)?.code === "UNSUPPORTED_AI_CONFIG" || typeof (error as { status?: unknown } | null)?.status === "number";
}

export const newRunId = () => randomUUID();
