import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam, BetaMessageParam, BetaToolResultBlockParam, BetaToolUnion, BetaToolUseBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { EffortLevel } from "../routing/effort";
import { DocToolError, DocToolInputs, DocumentEditor, docToolDefinitions } from "../documents/editor";
import type { DocumentSource } from "../documents/schema";
import { builderModel } from "./agent";
import { generateProjectImage, imageGenerationAvailable } from "./images";
import { BUILDER_EFFORT, IMAGE_COST_USD, creditsForUsd, usageCost, usdPerCredit } from "./pricing";
import { BOOK_SYSTEM, DECK_SYSTEM } from "./docs-prompt";

/** Events streamed to the chat. Shares the website builder's text/status/
 * usage/done/error shapes, plus live document snapshots. */
export type DocBuilderEvent =
  | { type: "status"; message: string }
  | { type: "text"; delta: string }
  | { type: "progress"; delta: string }
  | { type: "item_start"; key: string; label: string }
  | { type: "item"; key: string; label: string }
  | { type: "document"; document: DocumentSource; focus?: string }
  | { type: "image_start"; name: string; prompt: string }
  | { type: "image"; path: string; url: string; assetId: string }
  | { type: "tool_error"; tool: string; message: string }
  | { type: "usage"; credits: number }
  | { type: "done"; version: number; summary: string; charged: number }
  | { type: "error"; code: string; message: string };

export type DocBuilderRun = {
  client: SupabaseClient;
  scope: { workspaceId: string; projectId: string };
  editor: DocumentEditor;
  effort: EffortLevel;
  creditBudget: number;
  request: string;
  context: string;
  attachments: BetaContentBlockParam[];
  emit: (event: DocBuilderEvent) => void;
  signal: AbortSignal;
  deadline: number;
};
export type DocBuilderResult = { summary: string; credits: number; usd: number; finished: boolean };

const LIVE_TOOLS = new Set(["set_theme", "set_deck_details", "set_book_details", "write_slide", "delete_slide", "move_slide", "write_chapter", "edit_chapter", "delete_chapter", "move_chapter"]);

/** Human label for an in-flight or finished tool call, shown in the chat. */
export function describeTool(name: string, input: Record<string, unknown> | null, editor: DocumentEditor): string {
  const slide = input?.slide as { id?: string; title?: string; layout?: string } | undefined;
  const chapter = input?.chapter as { id?: string; title?: string } | undefined;
  const id = typeof input?.id === "string" ? input.id : undefined;
  const position = (itemId?: string) => {
    const list = editor.doc.kind === "deck" ? editor.doc.slides : editor.doc.chapters;
    const index = list.findIndex(item => item.id === itemId);
    return index >= 0 ? ` ${index + 1}` : "";
  };
  switch (name) {
    case "set_theme": return "Setting the theme";
    case "set_deck_details": case "set_book_details": return "Updating the title details";
    case "write_slide": return `Slide${position(slide?.id)}${slide?.title ? `: ${slide.title}` : ""}${slide?.layout ? ` (${slide.layout})` : ""}`;
    case "write_chapter": return `Chapter${position(chapter?.id)}${chapter?.title ? `: ${chapter.title}` : ""}`;
    case "edit_chapter": return `Editing chapter${position(id)}`;
    case "delete_slide": case "delete_chapter": return `Removing ${id ?? "an item"}`;
    case "move_slide": case "move_chapter": return `Reordering ${id ?? ""}`.trim();
    default: return name;
  }
}

/** Agentic edit loop for presentations and books. Structural tools are applied
 * the moment their input finishes streaming, so the preview updates slide by
 * slide; generate_image runs at the end of the step; finish validates. */
export async function runDocumentBuilder(run: DocBuilderRun): Promise<DocBuilderResult> {
  const policy = BUILDER_EFFORT[run.effort];
  const model = builderModel();
  const anthropic = new Anthropic({ maxRetries: 2, timeout: 600_000 });
  const imagesEnabled = imageGenerationAvailable() && policy.maxImages > 0;
  const budgetUsd = run.creditBudget * usdPerCredit();
  const kind = run.editor.kind;
  const tools = docToolDefinitions(kind, imagesEnabled) as unknown as BetaToolUnion[];
  let usd = 0, imagesUsed = 0, summary = "", finished = false, malformedTurns = 0;
  const imageLimit = Math.min(policy.maxImages, Math.max(0, Math.floor(budgetUsd / IMAGE_COST_USD / 3)));

  const messages: BetaMessageParam[] = [{ role: "user", content: [
    ...run.attachments,
    { type: "text", text: `${run.context}\n\nImage generation: ${imagesEnabled ? `available (up to ${imageLimit} images this run)` : "unavailable — design without images"}.\n\n<request>\n${run.request}\n</request>` },
  ] }];

  for (let turn = 0; turn < policy.maxTurns && !finished; turn++) {
    if (run.signal.aborted || Date.now() > run.deadline - 45_000) break;
    const stream = anthropic.beta.messages.stream({
      model, max_tokens: policy.maxTokens,
      betas: ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18"],
      fallbacks: "default",
      thinking: { type: "adaptive", display: "updates" },
      output_config: { effort: policy.intensity },
      cache_control: { type: "ephemeral" },
      system: [{ type: "text", text: kind === "deck" ? DECK_SYSTEM : BOOK_SYSTEM }],
      tools,
      messages,
    }, { signal: run.signal });

    const partial = new Map<number, { id: string; name: string; json: string; announced: boolean }>();
    const applied = new Map<string, { ok: boolean; text: string }>();
    stream.on("streamEvent", event => {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        partial.set(event.index, { id: event.content_block.id, name: event.content_block.name, json: "", announced: false });
        return;
      }
      if (event.type === "content_block_stop") {
        const block = partial.get(event.index);
        partial.delete(event.index);
        if (!block || !LIVE_TOOLS.has(block.name)) return;
        // Apply as soon as the call is complete: the preview grows slide by slide.
        let input: Record<string, unknown> | null = null;
        try { input = JSON.parse(block.json || "{}"); } catch { return; /* reported when the turn completes */ }
        try {
          const text = run.editor.apply(block.name, input);
          applied.set(block.id, { ok: true, text });
          const focus = (input?.slide as { id?: string } | undefined)?.id ?? (input?.chapter as { id?: string } | undefined)?.id ?? (typeof input?.id === "string" ? input.id : undefined);
          run.emit({ type: "document", document: run.editor.doc, ...(focus ? { focus } : {}) });
          run.emit({ type: "item", key: block.id, label: describeTool(block.name, input, run.editor) });
        } catch (error) {
          applied.set(block.id, { ok: false, text: toolMessage(block.name, error) });
        }
        return;
      }
      if (event.type !== "content_block_delta") return;
      if (event.delta.type === "text_delta") run.emit({ type: "text", delta: event.delta.text });
      else if (event.delta.type === "thinking_delta" && event.delta.thinking) run.emit({ type: "progress", delta: event.delta.thinking });
      else if (event.delta.type === "input_json_delta") {
        const block = partial.get(event.index);
        if (!block) return;
        block.json += event.delta.partial_json;
        if (block.announced || !LIVE_TOOLS.has(block.name)) return;
        const title = /"title"\s*:\s*"((?:[^"\\]|\\.){3,})"/.exec(block.json.slice(0, 1200))?.[1];
        if (title || block.json.length > 400 || !["write_slide", "write_chapter"].includes(block.name)) {
          block.announced = true;
          const label = block.name === "write_slide" ? `Writing slide${title ? `: ${JSON.parse(`"${title}"`)}` : ""}` : block.name === "write_chapter" ? `Writing chapter${title ? `: ${JSON.parse(`"${title}"`)}` : ""}` : describeTool(block.name, null, run.editor);
          run.emit({ type: "item_start", key: block.id, label });
        }
      }
    });

    let message;
    try { message = await stream.finalMessage(); }
    catch (error) {
      if (error instanceof Anthropic.APIError || run.signal.aborted || ++malformedTurns > 2) throw error;
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
      if (message.stop_reason === "end_turn") { messages.push({ role: "user", content: "Continue. When the document is complete and checked, call finish." }); continue; }
      break;
    }

    const truncated = message.stop_reason === "max_tokens";
    const results: BetaToolResultBlockParam[] = [];
    const imageJobs: Promise<void>[] = [];
    let finishUse: BetaToolUseBlock | undefined;
    for (const use of uses) {
      const ok = (text: string) => results.push({ type: "tool_result", tool_use_id: use.id, content: text });
      const fail = (text: string) => { results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: text }); run.emit({ type: "tool_error", tool: use.name, message: text }); };
      const early = applied.get(use.id);
      if (early) { if (early.ok) ok(early.text); else fail(early.text); continue; }
      if (truncated) { fail("Your response hit the output limit before this tool call completed. Write fewer or shorter items per step."); continue; }
      try {
        if (use.name === "finish") { finishUse = use; continue; }
        if (use.name === "generate_image") {
          const input = DocToolInputs.generate_image.parse(use.input);
          if (!imagesEnabled) { fail("Image generation is unavailable. Design without images."); continue; }
          if (imagesUsed >= imageLimit || usd + IMAGE_COST_USD > budgetUsd * 0.9) { fail("The image budget for this run is used up. Reuse existing images or remove the image field."); continue; }
          imagesUsed++; usd += IMAGE_COST_USD;
          run.emit({ type: "image_start", name: input.name, prompt: input.prompt });
          imageJobs.push(generateProjectImage(run.client, run.scope, { name: input.name, prompt: run.editor.imagePrompt(input.prompt), aspect: input.aspect }, run.signal).then(asset => {
            run.editor.addAsset({ name: input.name, id: asset.id, aspect: input.aspect, alt: input.alt, prompt: input.prompt });
            run.emit({ type: "image", path: asset.path, url: asset.url, assetId: asset.id });
            run.emit({ type: "document", document: run.editor.doc });
            ok(`Image "${input.name}" is ready (${input.aspect}). Reference it by name.`);
          }, () => fail(`Image generation for "${input.name}" failed. Continue without it (remove the reference).`)));
          continue;
        }
        const text = run.editor.apply(use.name, use.input);
        run.emit({ type: "document", document: run.editor.doc });
        ok(text);
      } catch (error) {
        fail(toolMessage(use.name, error));
      }
    }
    await Promise.all(imageJobs);
    if (finishUse) {
      // Validate after this step's images exist.
      try {
        const input = DocToolInputs.finish.parse(finishUse.input);
        const problems = run.editor.problems();
        if (problems.length) {
          results.push({ type: "tool_result", tool_use_id: finishUse.id, is_error: true, content: `Not finished yet. Fix these, then call finish again:\n- ${problems.join("\n- ")}` });
          run.emit({ type: "tool_error", tool: "finish", message: problems[0] });
        } else { summary = input.summary; finished = true; results.push({ type: "tool_result", tool_use_id: finishUse.id, content: "Saved." }); }
      } catch (error) { results.push({ type: "tool_result", tool_use_id: finishUse.id, is_error: true, content: toolMessage("finish", error) }); }
    }
    run.emit({ type: "usage", credits: creditsForUsd(usd) });
    if (finished) break;
    const order = new Map(uses.map((use, index) => [use.id, index]));
    results.sort((a, b) => order.get(a.tool_use_id)! - order.get(b.tool_use_id)!);
    messages.push({ role: "user", content: results });
    const remaining = budgetUsd - usd;
    if (remaining <= 0) break;
    if (remaining < budgetUsd * 0.25 || turn === policy.maxTurns - 2 || Date.now() > run.deadline - 120_000) {
      messages.push({ role: "system", content: "Budget or time is nearly used up. Finish the most important remaining work in this step and call finish now." });
    }
  }
  return { summary, credits: creditsForUsd(usd), usd, finished };
}

function toolMessage(name: string, error: unknown) {
  if (error instanceof DocToolError) return error.message;
  if (error instanceof z.ZodError) return `Invalid ${name} input: ${error.issues.slice(0, 3).map(issue => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")}.`;
  return `${name} failed.`;
}
