import "server-only";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaContentBlockParam, BetaMessageParam, BetaRawMessageStreamEvent, BetaToolResultBlockParam, BetaToolUnion, BetaToolUseBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { EffortLevel } from "../routing/effort";
import { WebsiteDesignDirectionSchema } from "../projects/website-source";
import { FileToolError, ProjectFiles } from "./files";
import { IMAGE_SIZES, imageConfiguration, openaiImageClient, storeGeneratedImage } from "./images";
import { BUILDER_EFFORT, aiCostUsdPerCredit } from "./pricing";
import { ContextMeter, budgetedStream, builderModels, type AnthropicLike } from "../ai/anthropic-call";
import { startBudgetedImage, type ImageClientLike } from "../ai/image-call";
import { UnpricedModelError, imageCallBoundMicrousd } from "../ai/prices";
import { SpendError, type RunSpend } from "../ai/run-spend";
import { BUILDER_SYSTEM } from "./prompt";

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
  | { type: "image"; path: string; url: string; assetId: string }
  | { type: "tool_error"; tool: string; message: string }
  | { type: "usage"; credits: number }
  | { type: "done"; version: number; summary: string; charged: number; changed?: boolean; finished?: boolean }
  | { type: "error"; code: string; message: string; retryable?: boolean };

const name = z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Use a short kebab-case name like hero-portrait.");
const ToolInputs = {
  write_file: z.object({ path: z.string(), content: z.string() }).strict(),
  edit_file: z.object({ path: z.string(), old_string: z.string(), new_string: z.string(), replace_all: z.boolean().optional() }).strict(),
  delete_file: z.object({ path: z.string() }).strict(),
  generate_image: z.object({ name, prompt: z.string().min(20).max(3000), aspect: z.enum(["landscape", "portrait", "square"]) }).strict(),
  finish: z.object({
    summary: z.string().min(1).max(2000),
    title: z.string().min(1).max(200).optional(),
    routes: z.array(z.object({ path: z.string().regex(/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/), title: z.string().min(1).max(200) }).strict()).max(50).optional(),
    design: WebsiteDesignDirectionSchema.optional(),
  }).strict(),
};

function tools(images: boolean): BetaToolUnion[] {
  const list: BetaToolUnion[] = [
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
  if (images) list.splice(3, 0, { name: "generate_image", description: "Generate one original, art-directed image for the website and register it in the project. Returns the URL to use in code (e.g. /images/hero-portrait.webp). Write a precise visual prompt: subject, composition, lighting or medium, palette, mood. Never request text, logos or watermarks in images.",
    input_schema: { type: "object", properties: { name: { type: "string", description: "kebab-case file name without extension" }, prompt: { type: "string" }, aspect: { type: "string", enum: ["landscape", "portrait", "square"] } }, required: ["name", "prompt", "aspect"], additionalProperties: false } });
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
  /** No step starts with less time than this left (default 45 s; tests use less). */
  stepGuardMs?: number;
  /** Injected providers (tests). Production uses the SDKs with retries disabled. */
  anthropic?: AnthropicLike;
  imageClient?: ImageClientLike;
  storeImage?: (request: { name: string; prompt: string; model: string }, bytes: Buffer) => ReturnType<typeof storeGeneratedImage>;
};

/** credits: customer-chargeable usage (confirmed cost); usd: provider cost incl. unconfirmed bounds. */
export type BuilderResult = { summary: string; title?: string; credits: number; usd: number; finished: boolean; stopped: string | null };

/** Agentic edit loop: Claude edits the in-memory project through tools until it
 * calls finish with a project that passes static checks, or the budget runs out. */
export async function runBuilder(run: BuilderRun): Promise<BuilderResult> {
  const policy = { ...BUILDER_EFFORT[run.effort], ...run.limits };
  const model = builderModel();
  const models = builderModels(model);
  const anthropic = run.anthropic ?? (new Anthropic({ maxRetries: 0, timeout: 600_000 }) as unknown as AnthropicLike);
  const rate = aiCostUsdPerCredit();
  const spend = run.spend;
  // The configured image model, or null when images are off (see imageConfiguration).
  const imageModelId = policy.maxImages > 0 ? imageConfiguration().model : null;
  // One image's worst case; images may use at most a third of the run's allowance.
  const imageBound = imageModelId ? imageCallBoundMicrousd(imageModelId, "medium", IMAGE_SIZES.portrait, "x".repeat(3000)) : Infinity;
  const imageLimit = imageModelId ? Math.min(policy.maxImages, Math.floor(spend.allowanceMicrousd / imageBound / 3)) : 0;
  const imageClient = imageModelId && imageLimit > 0 ? run.imageClient ?? openaiImageClient() : null;
  const storeImage = run.storeImage ?? ((request: { name: string; prompt: string; model: string }, bytes: Buffer) => storeGeneratedImage(run.client, run.scope, request, bytes));
  let imagesUsed = 0, summary = "", title: string | undefined, finished = false, malformedTurns = 0;
  const system = [{ type: "text" as const, text: BUILDER_SYSTEM }];
  const toolList = tools(imageLimit > 0);
  const meter = new ContextMeter(async messages => (await anthropic.beta.messages.countTokens({ model, system, tools: toolList, messages }, { signal: run.signal, maxRetries: 0, timeout: Math.max(1, Math.min(30_000, spend.timeLeftMs())) })).input_tokens);
  const usage = () => run.emit({ type: "usage", credits: spend.customerCredits(rate) });

  const messages: BetaMessageParam[] = [{ role: "user", content: [
    ...run.attachments,
    { type: "text", text: `${run.context}\n\nImage generation: ${imageLimit > 0 ? `available (up to ${imageLimit} images this run)` : "unavailable — use typography, CSS and inline SVG"}.\n\n<request>\n${run.request}\n</request>` },
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
            let job: { done: Promise<Buffer> };
            try {
              // The image's bound is reserved before the provider is contacted.
              job = await startBudgetedImage({ client: imageClient, spend, model: imageModelId, prompt: input.prompt, size: IMAGE_SIZES[input.aspect], quality: "medium", signal: run.signal });
            } catch (error) {
              fail(error instanceof SpendError && !error.graceful ? `${error.message} Continue without this image (use CSS/SVG artwork).` : "Image budget for this run is used up. Reuse existing images or use CSS/SVG artwork.");
              break;
            }
            imagesUsed++;
            run.emit({ type: "image_start", name: input.name, prompt: input.prompt });
            imageJobs.push(job.done.then(bytes => storeImage({ name: input.name, prompt: input.prompt, model: imageModelId }, bytes)).then(asset => {
              run.files.addAsset({ id: asset.id, path: asset.path, sha256: asset.sha256, bytes: asset.bytes, mediaType: asset.mediaType });
              run.emit({ type: "image", path: asset.path, url: asset.url, assetId: asset.id });
              results.push({ type: "tool_result", tool_use_id: use.id, content: `Image ready. Use src="${asset.url}" (${input.aspect}).` });
            }, () => fail("Image generation failed. Continue without this image (use CSS/SVG artwork instead).")));
            break;
          }
          case "finish": {
            const input = ToolInputs.finish.parse(use.input);
            const problems = run.files.problems();
            if (input.routes?.length) run.files.routes = input.routes.some(route => route.path === "/") ? input.routes : [{ path: "/", title: "Home" }, ...input.routes];
            if (input.design) run.files.design = input.design;
            if (!problems.length) { try { run.files.toSource(); } catch (error) { problems.push((error as Error).message); } }
            if (problems.length) { fail(`Not finished yet. Fix these problems, then call finish again:\n- ${problems.join("\n- ")}`); break; }
            summary = input.summary; title = input.title; finished = true;
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
    if (spend.remainingMicrousd < spend.allowanceMicrousd * 0.25 || turn === policy.maxTurns - 2 || Date.now() > deadline - 120_000) {
      messages.push({ role: "system", content: "Budget or time is nearly used up. Finish the most important remaining work in this step and call finish now." });
    }
  }
  return { summary, title, credits: spend.customerCredits(rate), usd: spend.providerMicrousd / 1e6, finished, stopped: spend.stopped };
}

/** Provider HTTP errors and spending-control errors end the run; only malformed streams are retried as a turn. */
export function isProviderOrSpendError(error: unknown) {
  return error instanceof Anthropic.APIError || error instanceof SpendError || error instanceof UnpricedModelError
    || (error as { code?: unknown } | null)?.code === "UNSUPPORTED_AI_CONFIG" || typeof (error as { status?: unknown } | null)?.status === "number";
}

export const newRunId = () => randomUUID();
