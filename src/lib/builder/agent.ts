import "server-only";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam, BetaMessageParam, BetaToolResultBlockParam, BetaToolUnion, BetaToolUseBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { EffortLevel } from "../routing/effort";
import { WebsiteDesignDirectionSchema } from "../projects/website-source";
import { FileToolError, ProjectFiles } from "./files";
import { generateProjectImage, imageGenerationAvailable } from "./images";
import { BUILDER_EFFORT, IMAGE_COST_USD, creditsForUsd, usageCost, usdPerCredit } from "./pricing";
import { BUILDER_SYSTEM } from "./prompt";

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
  | { type: "done"; version: number; summary: string; charged: number }
  | { type: "error"; code: string; message: string };

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
    { name: "finish", description: "Call once the website is complete and checked. Provide a short, friendly summary of what you built or changed (2-4 sentences, no code). Optionally set the site title, the list of page routes and the design direction.",
      input_schema: { type: "object", properties: {
        summary: { type: "string" }, title: { type: "string" },
        routes: { type: "array", items: { type: "object", properties: { path: { type: "string" }, title: { type: "string" } }, required: ["path", "title"], additionalProperties: false } },
        design: { type: "object", properties: { positioning: { type: "string" }, composition: { type: "string" }, typography: { type: "string" }, palette: { type: "string" }, imagery: { type: "string" }, motion: { type: "string" } }, required: ["positioning", "composition", "typography", "palette", "imagery", "motion"], additionalProperties: false },
      }, required: ["summary"], additionalProperties: false } },
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
  creditBudget: number;
  request: string;
  context: string;
  attachments: BetaContentBlockParam[];
  emit: (event: BuilderEvent) => void;
  signal: AbortSignal;
};

export type BuilderResult = { summary: string; title?: string; credits: number; usd: number; finished: boolean };

/** Agentic edit loop: Claude edits the in-memory project through tools until it
 * calls finish with a project that passes static checks, or the budget runs out. */
export async function runBuilder(run: BuilderRun): Promise<BuilderResult> {
  const policy = BUILDER_EFFORT[run.effort];
  const model = builderModel();
  const anthropic = new Anthropic({ maxRetries: 2, timeout: 600_000 });
  const imagesEnabled = imageGenerationAvailable() && policy.maxImages > 0;
  const budgetUsd = run.creditBudget * usdPerCredit();
  let usd = 0, imagesUsed = 0, summary = "", title: string | undefined, finished = false, malformedTurns = 0;

  const messages: BetaMessageParam[] = [{ role: "user", content: [
    ...run.attachments,
    { type: "text", text: `${run.context}\n\nImage generation: ${imagesEnabled ? `available (up to ${Math.min(policy.maxImages, Math.floor(budgetUsd / IMAGE_COST_USD / 3))} images this run)` : "unavailable — use typography, CSS and inline SVG"}.\n\n<request>\n${run.request}\n</request>` },
  ] }];

  for (let turn = 0; turn < policy.maxTurns && !finished; turn++) {
    if (run.signal.aborted) break;
    const stream = anthropic.beta.messages.stream({
      model, max_tokens: policy.maxTokens,
      betas: ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18"],
      fallbacks: "default",
      thinking: { type: "adaptive", display: "updates" },
      output_config: { effort: policy.intensity },
      cache_control: { type: "ephemeral" },
      system: [{ type: "text", text: BUILDER_SYSTEM }],
      tools: tools(imagesEnabled),
      messages,
    }, { signal: run.signal });

    const announced = new Set<number>();
    const partial = new Map<number, string>();
    stream.on("streamEvent", event => {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") partial.set(event.index, "");
      if (event.type !== "content_block_delta") return;
      if (event.delta.type === "text_delta") run.emit({ type: "text", delta: event.delta.text });
      else if (event.delta.type === "thinking_delta" && event.delta.thinking) run.emit({ type: "progress", delta: event.delta.thinking });
      else if (event.delta.type === "input_json_delta" && !announced.has(event.index)) {
        const text = (partial.get(event.index) ?? "") + event.delta.partial_json;
        partial.set(event.index, text.slice(0, 600));
        const path = /"path"\s*:\s*"([^"]+)"/.exec(text)?.[1];
        if (path) { announced.add(event.index); run.emit({ type: "file_start", path, op: "write" }); }
      }
    });

    let message;
    try { message = await stream.finalMessage(); }
    catch (error) {
      if (error instanceof Anthropic.APIError || run.signal.aborted || ++malformedTurns > 2) throw error;
      // A tool input that could not be parsed: the turn never completed, so re-issue it.
      run.emit({ type: "status", message: "Retrying an incomplete step…" });
      continue;
    }
    malformedTurns = 0;
    usd += usageCost(message.model, message.usage);
    run.emit({ type: "usage", credits: creditsForUsd(usd) });
    messages.push({ role: "assistant", content: message.content as BetaContentBlockParam[] });

    if (message.stop_reason === "refusal") throw Object.assign(new Error("The request was declined by the model's safety policy."), { code: "REFUSED" });
    const uses = message.content.filter((block): block is BetaToolUseBlock => block.type === "tool_use");
    if (!uses.length) {
      if (message.stop_reason === "end_turn") {
        messages.push({ role: "user", content: "Continue. When the website is complete and checked, call finish." });
        continue;
      }
      break;
    }

    const truncated = message.stop_reason === "max_tokens";
    const results: BetaToolResultBlockParam[] = [];
    const imageJobs: Promise<void>[] = [];
    for (const use of uses) {
      const fail = (text: string) => { results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: text }); run.emit({ type: "tool_error", tool: use.name, message: text }); };
      if (truncated) { fail("Your response hit the output limit before this tool call completed. Write smaller files, one or two per step."); continue; }
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
            if (!imagesEnabled) { fail("Image generation is unavailable. Use CSS, typography and inline SVG."); break; }
            if (imagesUsed >= policy.maxImages || usd + IMAGE_COST_USD > budgetUsd * 0.9) { fail("Image budget for this run is used up. Reuse existing images or use CSS/SVG artwork."); break; }
            if (run.files.assets.has(`public/images/${input.name}.webp`)) { fail(`An image named ${input.name} already exists at /images/${input.name}.webp. Reuse it or choose a new name.`); break; }
            imagesUsed++; usd += IMAGE_COST_USD;
            run.emit({ type: "image_start", name: input.name, prompt: input.prompt });
            imageJobs.push(generateProjectImage(run.client, run.scope, input, run.signal).then(asset => {
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
    run.emit({ type: "usage", credits: creditsForUsd(usd) });
    const order = new Map(uses.map((use, index) => [use.id, index]));
    results.sort((a, b) => order.get(a.tool_use_id)! - order.get(b.tool_use_id)!);
    if (finished) break;
    messages.push({ role: "user", content: results });
    const remaining = budgetUsd - usd;
    if (remaining <= 0) break;
    if (remaining < budgetUsd * 0.25 || turn === policy.maxTurns - 2) {
      messages.push({ role: "system", content: "Budget is nearly used up. Finish the most important remaining work in this step and call finish now." });
    }
  }
  return { summary, title, credits: creditsForUsd(usd), usd, finished };
}

export const newRunId = () => randomUUID();
