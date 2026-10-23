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
import { CONCEPT_TOOL, MAX_COMPS, checkConcept, imagePlanNote, sitePlanNote, withConceptComment, type ConceptRecord, type DesignComp } from "./concept";
import { storeProjectImage } from "./images";
import { COMP_PREVIEW_EDGE, imagePreview, type ImagePreview } from "./image-variants";

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
  | { type: "image_start"; name: string; prompt: string; replaces?: string; rejected?: string; comp?: boolean }
  | { type: "image"; path: string; url: string; assetId: string; model?: string; quality?: string; size?: string; reason?: string; costMicrousd?: number | null }
  | { type: "tool_error"; tool: string; message: string }
  | { type: "usage"; credits: number }
  | { type: "concept"; chosen: string; runnersUp: string[]; why: string; shots?: number; compositions?: string[] }
  | { type: "done"; version: number; summary: string; charged: number; changed?: boolean; finished?: boolean; build?: "passed" | "unverified" | null }
  | { type: "error"; code: string; message: string; retryable?: boolean };

const name = z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Use a short kebab-case name like hero-portrait.");
const ToolInputs = {
  write_file: z.object({ path: z.string(), content: z.string() }).strict(),
  edit_file: z.object({ path: z.string(), old_string: z.string(), new_string: z.string(), replace_all: z.boolean().optional() }).strict(),
  delete_file: z.object({ path: z.string() }).strict(),
  generate_comp: z.object({ section: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/, "Use the section id from the section plan."), viewport: z.enum(["desktop", "mobile"]),
    prompt: z.string().min(40).max(3000), text: z.string().trim().min(2).max(200) }).strict(),
  generate_image: z.object({ name, prompt: z.string().min(20).max(3000), aspect: z.enum(["landscape", "portrait", "square"]), kind: z.enum(IMAGE_KINDS).optional(),
    text: z.string().max(200).nullable().optional(), textPlacement: z.enum(["exact", "loose"]).optional(),
    replaces: name.optional(), rejected: z.string().trim().min(8).max(300).optional() }).strict()
    .refine(input => Boolean(input.replaces) === Boolean(input.rejected), "replaces and rejected go together: the image being regenerated and what is wrong with it."),
  finish: z.object({
    summary: z.string().min(1).max(2000),
    title: z.string().min(1).max(200).optional(),
    routes: z.array(z.object({ path: z.string().regex(/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/), title: z.string().min(1).max(200) }).strict()).max(50).optional(),
    design: WebsiteDesignDirectionSchema.optional(),
  }).strict(),
};

/** The comp tool: a finished website screen as one picture (type, image, colour and space designed together). */
const COMP_TOOL = { name: "generate_comp", description: `First build, after the concept: generate one design comp, a picture of a finished website screen in the art system, as an art director's reference you then build in code. It is never shown on the page. Use it for the first screen (desktop) and the two most important other sections, and optionally the phone first screen (viewport mobile); at most ${MAX_COMPS}, all in one step. prompt: the section's composition from the section plan, the type (face, size relative to the screen, weight, case, leading), the colour fields and their proportions, the photograph or drawing and its crop, overlaps, the motif and the empty space. text: the only words the comp shows (the section's real headline and primary action, under 200 characters); body copy appears as quiet lines.`,
  input_schema: { type: "object" as const, properties: { section: { type: "string", description: "The section id from the section plan" }, viewport: { type: "string", enum: ["desktop", "mobile"] }, prompt: { type: "string" }, text: { type: "string", description: "The headline and action words the comp shows" } }, required: ["section", "viewport", "prompt", "text"], additionalProperties: false } };

function tools(images: boolean, cutouts = false, textImages = false, concept = false, comps = false): BetaToolUnion[] {
  const list: BetaToolUnion[] = [
    ...(concept ? [CONCEPT_TOOL as unknown as BetaToolUnion] : []),
    ...(comps ? [COMP_TOOL as unknown as BetaToolUnion] : []),
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
  if (images) list.splice(3, 0, { name: "generate_image", description: `Generate one original, art-directed image for the website and register it in the project. Returns the URL and pixel size to use in code (e.g. /images/hero-portrait.webp, width 1536, height 1024). Write a precise visual prompt: subject, composition, lighting or medium, palette, mood, then the house style. Never request text, logos or watermarks in images. kind: photo (default), illustration, texture, icon, or cutout: one subject on a transparent background, trimmed to the subject, for layering over colour fields, shapes or other images${cutouts ? "" : " (cut-outs are unavailable with the configured image models)"}. text: null for no words in the image (the default, and the right choice when the words can be HTML over the image); otherwise the exact short words the image itself must show (a sign, label or poster lettering), with textPlacement "exact" when they must sit precisely where the prompt says${textImages ? "" : " (text in images is unavailable with the configured image models: use HTML text)"}. The platform picks the image model and quality per image. The result shows you the image itself: inspect it before using it. To regenerate an image you reject (once per slot, counted against the allowance), give a new name, replaces (the rejected image's name) and rejected (what is wrong), then point the slot at the new image; the rejected image leaves the project once nothing uses it.`,
    input_schema: { type: "object", properties: { name: { type: "string", description: "kebab-case file name without extension" }, prompt: { type: "string" }, aspect: { type: "string", enum: ["landscape", "portrait", "square"] }, kind: { type: "string", enum: [...IMAGE_KINDS] }, text: { type: ["string", "null"], description: "Exact words to render in the image, or null" }, textPlacement: { type: "string", enum: ["exact", "loose"] },
      replaces: { type: "string", description: "Only when regenerating: the name of the generated image this one replaces" }, rejected: { type: "string", description: "Only with replaces: what is wrong with the replaced image (the artefact, the AI look, the wrong subject or the style break)" } }, required: ["name", "prompt", "aspect"], additionalProperties: false } });
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
  /** Tighter limits for focused passes such as the design review. replaceOnly: images may only
   * regenerate an existing image (the review pass), never add a new one. */
  limits?: { maxTurns?: number; maxImages?: number; replaceOnly?: boolean };
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
  /** Stores a design comp as a registered (never published) asset; tests inject one. */
  storeComp?: (bytes: Buffer, provenance: Record<string, unknown>) => Promise<{ id: string; data?: Buffer }>;
  /** Compile check at finish (tests inject one); production bundles with esbuild. */
  compile?: (files: ReadonlyMap<string, string>) => Promise<CompileVerdict>;
};

/** credits: customer-chargeable usage (confirmed cost); usd: provider cost incl. unconfirmed bounds.
 * build: the finish-time compile verdict when the run finished, null otherwise. */
export type BuilderResult = { summary: string; title?: string; credits: number; usd: number; finished: boolean; build: "passed" | "unverified" | null; stopped: string | null; concept?: ConceptRecord | null };

/** Agentic edit loop: Claude edits the in-memory project through tools until it
 * calls finish with a project that passes static checks and compiles, or the budget runs out. */
export async function runBuilder(run: BuilderRun): Promise<BuilderResult> {
  const policy = { ...BUILDER_EFFORT[run.effort], ...run.limits };
  const model = builderModel();
  const models = builderModels(model);
  const anthropic = run.anthropic ?? (new Anthropic({ maxRetries: 0, timeout: 600_000 }) as unknown as AnthropicLike);
  const rate = aiCostUsdPerCredit();
  const spend = run.spend;
  // The configured image model, or null when images are off (see imageConfiguration).
  // The routable image models (ordered allowlist), or none when images are off (see imageConfiguration).
  // Websites have their own image allowance; a run's limits (0 on review passes, type-only designs) still win.
  const maxImages = run.limits?.maxImages ?? policy.maxWebsiteImages;
  const imageModels = maxImages > 0 ? imageConfiguration().models ?? [] : [];
  const imageModelId = imageModels[0] ?? null;
  // One image's worst case; images may use at most a third of the run's allowance.
  // Sizing the run's image allowance: the dearest allowed model at medium portrait with a full prompt.
  const imageBound = imageModels.length ? Math.max(...imageModels.map(model => imageCallBoundMicrousd(model, "medium", IMAGE_SIZES.portrait, "x".repeat(3400)))) : Infinity;
  const imageLimit = imageModelId ? Math.min(maxImages, Math.floor(spend.allowanceMicrousd / imageBound / 3)) : 0;
  const imageClient = imageModelId && imageLimit > 0 ? run.imageClient ?? openaiImageClient() : null;
  // Website images also get responsive copies (srcset) while they fit the site's image budget.
  const storeImage = run.storeImage ?? ((request: GeneratedImageRequest, bytes: Buffer) => storeGeneratedImage(run.client, run.scope, request, bytes,
    { variants: added => responsive.variantsFit([...run.files.assets.values()], added) }));
  const cutouts = imageModels.some(supportsTransparentImages);
  const textImages = imageModels.some(model => TEXT_IMAGE_MODELS.includes(model));
  let imagesUsed = 0, summary = "", title: string | undefined, finished = false, malformedTurns = 0;
  let concept: ConceptRecord | null = null;
  // Regeneration: each slot is regenerated at most once. Names replaced (or being replaced), and the replacements.
  const replacedNames = new Set<string>(), replacementNames = new Set<string>();
  // Completed regenerations: rejected name -> its replacement. The rejected image stays registered while any file
  // still references it (a run can end before the code is updated), so a regeneration never leaves a broken image.
  const replacedBy = new Map<string, string>();
  const replaceOnly = Boolean(run.limits?.replaceOnly);
  // Quality gates block a finish once per distinct problem; a repeat is accepted, so a false positive can never strand the work.
  const qualityReported = new Set<string>();
  let build: BuilderResult["build"] = null;
  const system = [{ type: "text" as const, text: BUILDER_SYSTEM }];
  // Design comps: first builds with a text-capable image model, paid from the part of the run's image third that the
  // photo allowance does not need at its worst case (comps never reduce the photographs a site may have).
  const compsAvailable = Boolean(run.concept) && !run.limits?.replaceOnly && imageLimit > 0 && textImages;
  // In call order (the jobs finish in any order); a failed comp leaves its slot empty.
  const comps: DesignComp[] = [], compSlots: (DesignComp | undefined)[] = [];
  let compsStarted = 0, imageReservedMicrousd = 0;
  const storeComp = run.storeComp ?? ((bytes: Buffer, provenance: Record<string, unknown>) => storeProjectImage(run.client, run.scope, bytes, provenance));
  const toolList = tools(imageLimit > 0, cutouts, textImages, Boolean(run.concept), compsAvailable);
  const meter = new ContextMeter(async messages => (await anthropic.beta.messages.countTokens({ model, system, tools: toolList, messages }, { signal: run.signal, maxRetries: 0, timeout: Math.max(1, Math.min(30_000, spend.timeLeftMs())) })).input_tokens);
  const usage = () => run.emit({ type: "usage", credits: spend.customerCredits(rate) });

  const messages: BetaMessageParam[] = [{ role: "user", content: [
    ...run.attachments,
    { type: "text", text: `${run.context}\n\nImage generation: ${imageLimit > 0 ? (replaceOnly
      ? `available only to regenerate ${imageLimit === 1 ? "one existing image" : `up to ${imageLimit} existing images`} that crop and placement cannot fix (pass replaces and rejected); it comes back to you as a picture to inspect`
      : `available (up to ${imageLimit} images this run${cutouts ? ", transparent cut-outs included" : "; transparent cut-outs unavailable"}); each image comes back to you as a picture: inspect it before you place it (see IMAGERY)`) : "unavailable — use typography, CSS and inline SVG"}.\n\n<request>\n${run.request}\n</request>` },
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
            if (!responsive.siteImageFits([...run.files.assets.values()])) { fail("This site already holds as many images as a published site can carry. Reuse an existing image or use CSS/SVG artwork."); break; }
            if (run.files.assets.has(`public/images/${input.name}.webp`)) { fail(`An image named ${input.name} already exists at /images/${input.name}.webp. Reuse it or choose a new name.`); break; }
            const rejection = regenerationProblem(input, { replaceOnly, exists: other => run.files.assets.has(`public/images/${other}.webp`), replaced: replacedNames, replacements: replacementNames });
            if (rejection) { fail(rejection); break; }
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
            imageReservedMicrousd += route.boundMicrousd;
            if (input.replaces) { replacedNames.add(input.replaces); replacementNames.add(input.name); }
            run.emit({ type: "image_start", name: input.name, prompt: input.prompt, ...(input.replaces ? { replaces: input.replaces, rejected: input.rejected } : {}) });
            const started = job;
            imageJobs.push(started.done.then(async bytes => {
              const detail = await started.detail;
              const record = { model: route.model, quality: route.quality, size: route.size, reason: route.reason, text: input.text ?? null, costMicrousd: detail.costMicrousd, outputTokens: detail.outputTokens, overrun: detail.overrun };
              const asset = await storeImage({ name: input.name, prompt: route.prompt, model: route.model, kind, transparent: route.background === "transparent", route: record }, bytes);
              // What the builder sees: a small preview of the stored image (best effort; text only without it).
              const preview = await imagePreview(asset.data ?? bytes).catch(() => null);
              return { asset, record, preview };
            }).then(({ asset, record, preview }) => {
              if (input.replaces) replacedBy.set(input.replaces, input.name);
              run.files.addAsset({ id: asset.id, path: asset.path, sha256: asset.sha256, bytes: asset.bytes, mediaType: asset.mediaType });
              // Parallel jobs checked the budget before storing; re-check against what is registered now.
              const copies = Boolean(asset.variants?.length && responsive.variantsFit([...run.files.assets.values()], asset.variants));
              if (copies) for (const variant of asset.variants ?? []) run.files.addAsset(variant);
              run.emit({ type: "image", path: asset.path, url: asset.url, assetId: asset.id, model: record.model, quality: record.quality, size: record.size, reason: record.reason, costMicrousd: record.costMicrousd });
              results.push({ type: "tool_result", tool_use_id: use.id, content: imageResultContent(imageReadyMessage({ ...asset, copies }, input.aspect, kind, { name: input.name, replaces: input.replaces, preview: Boolean(preview) }), preview) });
            }, () => {
              // A failed regeneration keeps the original in place, so the slot may be tried again.
              if (input.replaces) { replacedNames.delete(input.replaces); replacementNames.delete(input.name); }
              fail("Image generation failed. Continue without this image (use CSS/SVG artwork instead).");
            }));
            break;
          }
          case "generate_comp": {
            const input = ToolInputs.generate_comp.parse(use.input);
            if (!compsAvailable || !imageClient) { fail("Design comps are only for a first build with a text-capable image model. Build from the art system and the section plan."); break; }
            if (!concept) { fail("Record the concept, with its art system and section plan, before generating design comps."); break; }
            if (compsStarted >= MAX_COMPS) { fail(`At most ${MAX_COMPS} design comps per build. Build the other sections from the art system and the comps you have.`); break; }
            if (comps.some(comp => comp.section === input.section && comp.viewport === input.viewport)) { fail(`There is already a ${input.viewport} comp for ${input.section}.`); break; }
            const route = routeImage({ kind: "illustration", aspect: input.viewport === "desktop" ? "landscape" : "portrait", text: input.text, textPlacement: "loose" }, compPrompt(input, concept), imageModels);
            if (!route.ok) { fail(route.error); break; }
            const photoReserve = Math.max(0, imageLimit - imagesUsed) * imageBound;
            if (imageReservedMicrousd + route.boundMicrousd + photoReserve > spend.allowanceMicrousd / 3 || spend.remainingMicrousd - route.boundMicrousd < spend.allowanceMicrousd * 0.1) {
              fail("No image budget is left for another design comp. Build from the art system and the comps you have."); break;
            }
            let job: Awaited<ReturnType<typeof startBudgetedImage>>;
            try {
              job = await startBudgetedImage({ client: imageClient, spend, model: route.model, prompt: route.prompt, size: route.size, quality: route.quality, signal: run.signal, allowHigh: route.allowHigh });
            } catch (error) {
              fail(error instanceof SpendError && !error.graceful ? `${error.message} Build without this comp.` : "No image budget is left for another design comp. Build from the art system and the comps you have.");
              break;
            }
            const slot = compsStarted++; imageReservedMicrousd += route.boundMicrousd;
            run.emit({ type: "image_start", name: `comp-${input.section}-${input.viewport}`, prompt: input.prompt, comp: true });
            const started = job, record = concept;
            imageJobs.push(started.done.then(async bytes => {
              const detail = await started.detail;
              const stored = await storeComp(bytes, { kind: "design-comp", section: input.section, viewport: input.viewport, model: route.model, prompt: route.prompt.slice(0, 2000), costMicrousd: detail.costMicrousd });
              const preview = await imagePreview(stored.data ?? bytes, { maxEdge: COMP_PREVIEW_EDGE }).catch(() => null);
              return { stored, preview };
            }).then(({ stored, preview }) => {
              compSlots[slot] = { section: input.section, viewport: input.viewport, asset: stored.id };
              comps.splice(0, comps.length, ...compSlots.filter((entry): entry is DesignComp => Boolean(entry)));
              record.comps = [...comps];
              run.emit({ type: "status", message: `Design comp ready: ${input.section} (${input.viewport})` });
              results.push({ type: "tool_result", tool_use_id: use.id, content: imageResultContent(compReadyMessage(input), preview) });
            }, () => fail("The design comp could not be made. Build this section from the art system and the section plan.")));
            break;
          }
          case "concept": {
            if (!run.concept) { fail("The concept step is only for a first build; continue with the current design."); break; }
            const checked = checkConcept(use.input, { images: replaceOnly ? 0 : imageLimit, sitePlan: true });
            if (!checked.ok) { fail(checked.problem); break; }
            concept = checked.record;
            run.emit({ type: "concept", chosen: concept.chosen.name, runnersUp: concept.runnersUp.map(item => item.name), why: concept.why, ...(concept.imagePlan ? { shots: concept.imagePlan.shots.length } : {}), ...(concept.sections ? { compositions: concept.sections.map(section => section.composition) } : {}) });
            results.push({ type: "tool_result", tool_use_id: use.id, content: `Concept recorded. Build only "${concept.chosen.name}": ${concept.chosen.headline} — signature device: ${concept.chosen.device}. Put the device on the first screen and carry it through the sections; it must serve the primary action (${concept.chosen.action}). ${sitePlanNote(concept)}${concept.imagePlan ? ` ${imagePlanNote(concept.imagePlan)}` : ""}` });
            break;
          }
          case "finish": {
            const input = ToolInputs.finish.parse(use.input);
            const problems = run.files.problems();
            // A first build records its concepts before it can finish (once: a repeat is accepted).
            const noConcept = "Before finishing a first build, call the concept tool once with 2-3 genuinely distinct concepts, scored on the rubric, and keep building the strongest.";
            if (run.concept && !concept && !qualityReported.has(noConcept)) { qualityReported.add(noConcept); problems.push(noConcept); }
            // A rejected image still in use: its slot should show the regenerated one (once: a repeat is accepted).
            for (const [rejected, replacement] of replacedBy) {
              const stale = `The page still shows /images/${rejected}.webp, which you rejected and regenerated as /images/${replacement}.webp: point that slot at the new src with its width and height.`;
              if (imageInUse(run.files.files, rejected) && !qualityReported.has(stale)) { qualityReported.add(stale); problems.push(stale); }
            }
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
  // Rejected images leave the project (with their responsive copies) once no file references them.
  for (const rejected of replacedBy.keys()) if (!imageInUse(run.files.files, rejected)) run.files.removeAsset(`public/images/${rejected}.webp`);
  // The chosen concept and its runners-up stay in the source (also for a continuation, which reads the files).
  const app = run.files.files.get("src/App.tsx");
  if (concept && app !== undefined) {
    const commented = withConceptComment(app, concept);
    if (commented !== app) { run.files.write("src/App.tsx", commented); run.emit({ type: "file", path: "src/App.tsx", op: "write", content: commented }); }
  }
  return { summary, title, credits: spend.customerCredits(rate), usd: spend.providerMicrousd / 1e6, finished, build, stopped: spend.stopped, concept };
}

/** The comp prompt: a finished screen of this site in its art system (the router appends the exact words). */
export function compPrompt(input: { section: string; viewport: "desktop" | "mobile"; prompt: string }, concept: Pick<ConceptRecord, "artSystem" | "chosen">) {
  const art = concept.artSystem;
  const screen = input.viewport === "desktop" ? "a desktop website screen at 1440 px wide" : "a phone website screen at 390 px wide";
  return [
    `A design comp: ${screen}, shown flat and full-frame as a screenshot of the browser viewport (no device, no browser window, no mockup, no perspective), for the "${input.section}" section of a website whose concept is "${concept.chosen.name}". Designed by an award-winning web studio: editorial layout with a clear grid, dramatic type scale, deliberate colour fields and calm negative space.`,
    input.prompt,
    art ? `Art system: palette ${art.palette}. Type: ${art.type}. Imagery: ${art.imagery}. Motif: ${art.motif}.` : "",
    "Body copy, navigation and small labels are shown only as quiet thin grey lines, never as words. Real-looking photography or a crafted drawing as the art system says; never stock-looking, no AI look (oversaturation, HDR glow, plastic skin).",
  ].filter(Boolean).join("\n");
}

/** Tool result for a design comp: how to read it and what to build from it. */
export function compReadyMessage(input: { section: string; viewport: string }) {
  return `Design comp for ${input.section} (${input.viewport}), above. It is your reference only: it is never shown on the page or registered as a site image, and its lettering is never copied (spell from your own copy). Read it as an art director's comp: the grid and columns, the headline's size relative to the frame (the frame is ${input.viewport === "desktop" ? "1440" : "390"} px wide), weights and case, the colour fields and their proportions, where the image sits and how it is cropped, overlaps and the empty space. Next, generate the text-free images it shows with generate_image (same subject, crop, light and position, described from this comp; inspect them as usual), then build the section to match the comp as closely as code allows: grid, scale, type sizes and weights, colour fields, overlaps, image crops and negative space, with live HTML text and real buttons and links. Every accessibility, contrast, honesty and 360 px rule wins over the comp.`;
}

/** The client's own images: their imported photos (/images/photo-N.webp, redesign-server.ts) and the brand
 * logo (/images/brand-logo.webp, brand/kit.ts). Generated images never replace them. */
const CLIENT_IMAGE_NAME = /^(?:photo-[0-9]+|brand-logo)$/;

/** Why a generate_image call may not regenerate (or, in a replace-only pass, add) an image, or null.
 * Each slot is regenerated at most once: a replacement cannot itself be replaced, nor a slot twice. */
export function regenerationProblem(input: { name: string; replaces?: string },
  state: { replaceOnly: boolean; exists: (name: string) => boolean; replaced: ReadonlySet<string>; replacements: ReadonlySet<string> }): string | null {
  if (!input.replaces) return state.replaceOnly
    ? "In this pass generate_image only regenerates an existing image that crop and placement cannot fix (AI artefacts, the wrong subject): pass replaces (its name) and rejected (what is wrong). Otherwise fix the image with CSS (object-position, aspect, placement) or reuse an existing one."
    : null;
  if (input.replaces === input.name) return `Give the regenerated image a new name (for example ${input.replaces}-2) and update its src, width and height in the code.`;
  if (state.replacements.has(input.replaces)) return `${input.replaces} is already a regenerated image: each slot is regenerated at most once. Use it with a crop or object-position that keeps the flaw out of frame, swap it for another generated image, or use CSS/SVG artwork in that slot.`;
  if (state.replaced.has(input.replaces)) return `${input.replaces} has already been regenerated once. Use its replacement.`;
  if (CLIENT_IMAGE_NAME.test(input.replaces)) return `${input.replaces} is the client's own image (their photo or logo): it is never replaced by a generated one. Fix its crop or placement with CSS instead.`;
  if (!state.exists(input.replaces)) return `There is no generated image named ${input.replaces} to replace. Use the name of an existing image (without /images/ or .webp).`;
  return null;
}

/** Whether any project file references the generated image /images/<name>.webp. */
export function imageInUse(files: ReadonlyMap<string, string>, name: string) {
  const url = `/images/${name}.webp`;
  for (const content of files.values()) if (content.includes(url)) return true;
  return false;
}

/** The inspection the builder does on every generated image it sees, before using it. */
export const IMAGE_INSPECTION = "Inspect it at full attention before you use it. Reject it when it shows AI artefacts (malformed hands, fingers, faces or teeth; gibberish lettering, fake signage or labels; warped straight lines, impossible geometry or joins; duplicated, fused or melted objects), the AI look (oversaturated colour, plastic skin, HDR glow or a golden glow over everything, showroom perfection: a room or object that looks like a 3D architectural or catalogue render, spotless, evenly lit and colour-matched to the palette; a centred symmetrical subject), the wrong subject for the brief, or a break with the set: a medium, rendering, grade or light that differs from the images already made (a glossy 3D render beside illustrations, a studio shot beside documentary photographs), or a material that reads false (plastic clay, wax food, rubbery skin).";

/** Tool result for a stored image: the URL, its real pixel size (for width/height, so nothing shifts), for cut-outs
 * whether the alpha survived, when responsive copies were stored that the platform adds the srcset and the
 * code only sets sizes for the slot (without it every copy is chosen for a full-width slot), and, with a preview,
 * the inspection and art direction the builder does before placing it. */
export function imageReadyMessage(asset: { url: string; width?: number; height?: number; transparent?: boolean; copies?: boolean }, aspect: string, kind: string,
  seen: { name?: string; replaces?: string; preview?: boolean } = {}) {
  const size = asset.width && asset.height ? ` width="${asset.width}" height="${asset.height}"` : "";
  const note = kind === "cutout"
    ? (asset.transparent ? " Transparent cut-out trimmed to the subject: layer it over a colour field, shape or image; do not put it in a boxed card." : " The image came back opaque: frame it like a photo on a matching background.")
    : "";
  const copies = asset.copies ? " Smaller copies are added as its srcset automatically (no srcSet in code): set sizes for its slot, e.g. sizes=\"(min-width: 900px) 50vw, 100vw\" for a half-width image." : "";
  const ready = `Image ready. Use src="${asset.url}"${size} (${kind}, ${aspect}).${note}${copies}`;
  if (!seen.preview) return ready;
  const shown = ` The picture above is this image as generated (a small preview${kind === "cutout" && asset.transparent ? ", transparent areas shown as grey" : ""}).`;
  const verdict = seen.replaces
    ? ` This regenerates ${seen.replaces}: point its slot at this src, width and height now (the rejected image leaves the project once nothing uses it). It cannot be regenerated again: if it still shows a flaw, crop it out of frame with the slot's aspect and object-position, or use CSS/SVG artwork in that slot.`
    : ` If you reject it, call generate_image once more for this slot with a new name, replaces="${seen.name ?? "this-image"}", rejected (what is wrong) and a prompt that fixes the cause (it counts against the allowance; a slot is regenerated at most once).`;
  return `${ready}${shown} ${IMAGE_INSPECTION}${verdict} Otherwise, before placing it, note to yourself where its focal point and its calm, empty space are, then art-direct the slot: an aspect and crop that serve its job, object-position per breakpoint that keeps the focal point in frame on phones, and text, captions or panels on the calm side or edge, never over the subject.`;
}

/** Tool result content: the preview image first (when there is one), then the text. */
export function imageResultContent(text: string, preview: ImagePreview | null): BetaToolResultBlockParam["content"] {
  if (!preview) return text;
  return [{ type: "image", source: { type: "base64", media_type: preview.mediaType, data: preview.data } }, { type: "text", text }];
}

/** Provider HTTP errors and spending-control errors end the run; only malformed streams are retried as a turn. */
export function isProviderOrSpendError(error: unknown) {
  return error instanceof Anthropic.APIError || error instanceof SpendError || error instanceof UnpricedModelError
    || (error as { code?: unknown } | null)?.code === "UNSUPPORTED_AI_CONFIG" || typeof (error as { status?: unknown } | null)?.status === "number";
}

export const newRunId = () => randomUUID();
