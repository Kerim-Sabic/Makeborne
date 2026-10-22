import type { BuilderResult } from "./agent";
import type { CompileVerdict } from "./compile";
import type { ProjectFiles } from "./files";
import { accepted, failedIds, websiteEvidence } from "./acceptance";
import { MULTI_STAGE_CLASSES, runRouted, type AttemptRole, type Evaluation, type RouteEvent, type RouteStage, type RoutingDecision } from "../ai/model-routing";
import type { RunSpend } from "../ai/run-spend";

export { MULTI_STAGE_CLASSES };
type StageEvent = RouteEvent | { type: "status"; message: string } | { type: "delete"; path: string } | { type: "file"; path: string; op: "write"; content: string };

/** The request for a targeted repair: the original request plus the evidence to fix (gate findings, no other content). */
export function repairRequest(request: string, notes: readonly string[]) {
  return `${request}\n\nRepair: the previous attempt at this request did not pass these checks. Fix only these in the current files, keep everything else as it is, then call finish.\n- ${(notes.length ? notes : ["The previous attempt stopped before it called finish. Complete the request."]).join("\n- ")}`;
}
/** The build route's context with its current_files block re-read from the working copy (a repair starts from the current state). */
export function refreshContext(context: string, files: ProjectFiles) {
  const block = `<current_files>\n${files.snapshot()}\n</current_files>\nExisting images: ${[...files.assets.values()].map(asset => `/${asset.path.slice(7)}`).join(", ") || "none"}`;
  return /<current_files>[\s\S]*<\/current_files>(?:\nExisting images: [^\n]*)?/.test(context) ? context.replace(/<current_files>[\s\S]*<\/current_files>(?:\nExisting images: [^\n]*)?/, () => block) : `${context}\n${block}`;
}

/** What one website attempt established against the decision's required checks (acceptance-v1, in-loop evidence). */
export async function evaluateWebsite(result: BuilderResult, input: { route: RoutingDecision; files: ProjectFiles; compile: (files: ReadonlyMap<string, string>) => Promise<CompileVerdict> }): Promise<Evaluation> {
  const ids = input.route.inLoopChecks;
  const multiStage = MULTI_STAGE_CLASSES.has(input.route.class);
  if (result.finished) {
    const checks = websiteEvidence({ finished: true, build: result.build, contrast: result.contrast ?? null, problems: [], waived: result.waived }, ids);
    if (accepted(checks)) return { kind: "accept", checks, problems: [] };
    // Missing verification (no compiler or browser) is not a pass, and is a renderer problem: never escalated.
    return failedIds(checks).length ? { kind: "quality", checks, problems: result.waived?.length ? result.waived : failedIds(checks) } : { kind: "unverified", checks, problems: [] };
  }
  const checks = websiteEvidence({ finished: false, build: null, contrast: null, problems: result.problems ?? [] }, ids);
  if (multiStage) {
    // Unfinished first builds and redesigns continue in the next stage when their progress is usable.
    if (!input.files.changed.size) return { kind: "quality", checks, problems: ["no usable change"] };
    try { input.files.toSource(); } catch { return { kind: "quality", checks, problems: ["invalid project source"] }; }
    return (await input.compile(input.files.files)).status === "failed" ? { kind: "quality", checks, problems: ["progress does not compile"] } : { kind: "continue", checks, problems: [] };
  }
  const problems = result.problems ?? [];
  return { kind: problems.length ? "quality" : "incomplete", checks, problems };
}

/**
 * One website stage under its routing decision (../ai/model-routing.ts runRouted): off and shadow run one attempt exactly
 * as before; on runs the bounded state machine (initial, at most one targeted repair from the current files, at most one
 * escalation from the starting files). An escalation restarts from the files the stage started with and tells the client
 * what was put back. Shared by the build route (website-run.ts) and the eval harness, so both run exactly this logic.
 */
export function routedWebsiteStage(input: {
  route: RoutingDecision; stage: RouteStage; files: ProjectFiles; spend: RunSpend; deadline: number; signal: AbortSignal;
  emit: (event: StageEvent) => void;
  compile: (files: ReadonlyMap<string, string>) => Promise<CompileVerdict>;
  attempt: (plan: { role: AttemptRole; model: string; deadline: number; repairNotes: string[] }) => Promise<BuilderResult>;
}) {
  const { route, files, compile, emit } = input;
  const checkpoint = files.checkpoint();
  return runRouted({ route, stage: input.stage, spend: input.spend, deadline: input.deadline, signal: input.signal, emit, attempt: input.attempt,
    evaluate: result => evaluateWebsite(result, { route, files, compile }),
    reset: () => {
      const changed = files.restore(checkpoint);
      for (const path of changed.deleted) emit({ type: "delete", path });
      for (const path of changed.written) emit({ type: "file", path, op: "write", content: files.files.get(path)! });
    } });
}
