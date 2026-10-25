import { z } from "zod";
import { SpendError, type RunSpend } from "../ai/run-spend";
import { UnpricedModelError, UnsupportedConfigurationError } from "../ai/prices";

/**
 * One bounded tool-use loop, shared by the lead and by specialists. It never
 * retries a model turn by itself: each paid attempt is reserved and recorded
 * by the RunSpend it is given, and any failed or uncertain attempt ends the
 * loop with a code. Tools run only when permitted, only with arguments that
 * pass their schema, and never after Stop. No tool can publish, send or write
 * the project: tools return data; the lead applies a change through the
 * operation's expected-version save.
 */
export type ToolEffect = "read" | "draft";
export type ToolContext = Readonly<{
  /** The text of one of the task's bound inputs (index into its inputs), verified against its recorded digest. */
  readInput(index: number): Promise<string>;
  signal: AbortSignal;
  /** The step's spending (a specialist's child view inside a specialist). A paid tool reserves through it, never a budget of its own. */
  spend: RunSpend;
}>;
export type AgencyTool<A = unknown> = Readonly<{
  name: string; description: string; args: z.ZodType<A>; effect: ToolEffect;
  run(args: A, context: ToolContext): Promise<unknown>;
}>;
/** Names the loop owns; a registered tool may not take them. */
export const RESERVED_TOOL_NAMES: ReadonlySet<string> = new Set(["submit_result", "delegate"]);

export type ModelBlock = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };
export type ModelTurn = { content: ModelBlock[]; stopReason: string | null };
export type ToolDefinition = { name: string; description: string; input_schema: Record<string, unknown> };
export type ModelRequest = { system: string; messages: unknown[]; tools: ToolDefinition[]; maxOutputTokens: number; spend: RunSpend; signal: AbortSignal };
/** A model turn. Production: anthropicModelPort (budgeted, no retries). Tests: fakes that reserve through the same RunSpend. */
export type ModelPort = (request: ModelRequest) => Promise<ModelTurn>;

export type LoopFailure = "CANCELLED" | "MAX_TURNS" | "INVALID_TOOL_ARGUMENTS" | "UNSUPPORTED_CONFIGURATION" | "PROVIDER_FAILED" | "INPUT_CHANGED"
  | "RUN_BUDGET" | "HOLD_EXPIRED" | "OVERRUN" | "PROVIDER_LIMIT" | "PROVIDER_DISABLED" | "SPEND_UNAVAILABLE";
/** Thrown by a tool to end the step (for example, a bound input no longer matches its digest). */
export class TaskStop extends Error { constructor(readonly code: LoopFailure, message: string) { super(message); } }
export type LoopOutcome<R> = { ok: true; result: R; turns: number } | { ok: false; code: LoopFailure; turns: number };

export function toolDefinition(name: string, description: string, schema: z.ZodType): ToolDefinition {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  if (json.type !== "object") throw new Error(`Tool "${name}" needs an object schema.`);
  return { name, description, input_schema: json };
}

const RESULT_TOOL = "submit_result";
const MAX_TOOL_RESULT_CHARS = 20_000;
function toolText(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "null";
  return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[truncated]` : text;
}

export async function runTaskLoop<R>(input: {
  /** Text, or content blocks (e.g. labelled images for a reviewer) for the first user message. */
  system: string; prompt: string | readonly unknown[]; tools: readonly AgencyTool[]; result: z.ZodType<R>; resultDescription: string;
  maxTurns: number; maxOutputTokens: number; spend: RunSpend; signal: AbortSignal; model: ModelPort; context: ToolContext;
  /** Durable Stop check before a draft-producing action (the operation heartbeat in production). Throws to refuse. */
  beforeDraft?: () => Promise<void>;
  /** Invalid tool calls tolerated before the loop stops (default 2). */
  maxInvalid?: number;
  /** Called before each model turn (durable progress). */
  onTurn?: (turn: number) => void;
}): Promise<LoopOutcome<R>> {
  const byName = new Map(input.tools.map(tool => [tool.name, tool] as const));
  if (byName.size !== input.tools.length || input.tools.some(tool => RESERVED_TOOL_NAMES.has(tool.name) && tool.name !== "delegate"))
    throw new Error("Tool names must be unique and not reserved.");
  const definitions = [...input.tools.map(tool => toolDefinition(tool.name, tool.description, tool.args)), toolDefinition(RESULT_TOOL, input.resultDescription, input.result)];
  const messages: unknown[] = [{ role: "user", content: input.prompt }];
  const stopped = () => input.signal.aborted || input.spend.stopped === "CANCELLED";
  let invalid = 0, turns = 0;
  const fail = (code: LoopFailure): LoopOutcome<R> => ({ ok: false, code, turns });
  const fromError = (error: unknown): LoopOutcome<R> => {
    if (error instanceof SpendError || error instanceof TaskStop) return fail(error.code);
    if (error instanceof UnsupportedConfigurationError || error instanceof UnpricedModelError) return fail("UNSUPPORTED_CONFIGURATION");
    return fail(stopped() ? "CANCELLED" : "PROVIDER_FAILED");
  };
  while (turns < input.maxTurns) {
    if (stopped()) return fail("CANCELLED");
    turns++;
    input.onTurn?.(turns);
    let turn: ModelTurn;
    try { turn = await input.model({ system: input.system, messages, tools: definitions, maxOutputTokens: input.maxOutputTokens, spend: input.spend, signal: input.signal }); }
    catch (error) { return fromError(error); }
    messages.push({ role: "assistant", content: turn.content });
    const uses = turn.content.filter((block): block is Extract<ModelBlock, { type: "tool_use" }> => block.type === "tool_use");
    if (!uses.length) { messages.push({ role: "user", content: `Call ${RESULT_TOOL} with the final result.` }); continue; }
    const results: unknown[] = [];
    for (const use of uses) {
      if (stopped()) return fail("CANCELLED");
      const refuseCall = (message: string) => { invalid++; results.push({ type: "tool_result", tool_use_id: use.id, content: message, is_error: true }); };
      if (use.name === RESULT_TOOL) {
        const parsed = input.result.safeParse(use.input);
        if (parsed.success) return { ok: true, result: parsed.data, turns };
        refuseCall(`Invalid result: ${parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`);
      } else {
        const tool = byName.get(use.name);
        const args = tool?.args.safeParse(use.input);
        if (!tool) refuseCall(`Tool "${use.name.slice(0, 64)}" is not available for this task.`);
        else if (!args?.success) refuseCall(`Invalid arguments for ${tool.name}: ${args!.error.issues.slice(0, 5).map(issue => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`);
        else {
          try {
            if (tool.effect === "draft" && input.beforeDraft) await input.beforeDraft();
            if (stopped()) return fail("CANCELLED");
            results.push({ type: "tool_result", tool_use_id: use.id, content: toolText(await tool.run(args.data, input.context)) });
          } catch (error) {
            if (error instanceof SpendError || error instanceof TaskStop || stopped()) return fromError(error);
            results.push({ type: "tool_result", tool_use_id: use.id, content: "The tool could not complete this action.", is_error: true });
          }
        }
      }
      if (invalid > (input.maxInvalid ?? 2)) return fail("INVALID_TOOL_ARGUMENTS");
    }
    messages.push({ role: "user", content: results });
  }
  return fail("MAX_TURNS");
}
