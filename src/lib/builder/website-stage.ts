import type { BuilderResult } from "./agent";
import type { CompileVerdict } from "./compile";
import type { ProjectFiles } from "./files";
import { runRouted, type ModelRoute, type RouteEvent, type RouteStage } from "../ai/model-routing";
import type { RunSpend } from "../ai/run-spend";

/** Classes whose unfinished work is saved and continued by the next stage; only a hard failure escalates them. */
export const MULTI_STAGE_CLASSES: ReadonlySet<string> = new Set(["new-site", "redesign", "continuation"]);

type StageEvent = RouteEvent | { type: "status"; message: string } | { type: "delete"; path: string } | { type: "file"; path: string; op: "write"; content: string };

/**
 * One website stage on its routed model, with at most one escalation to the builder model (../ai/model-routing.ts).
 * Single-pass stages (edits, reviews) must pass the finish gates (static, quality, compile, contrast); multi-stage
 * builds escalate only when nothing usable that compiles was produced (unfinished work is continued as before).
 * An escalation restarts from the files the stage started with and tells the client what was put back.
 * Shared by the build route (website-run.ts) and the eval harness, so both run exactly this logic.
 */
export function routedWebsiteStage(input: {
  route: ModelRoute; stage: RouteStage; files: ProjectFiles; spend: RunSpend; deadline: number; signal: AbortSignal;
  emit: (event: StageEvent) => void;
  compile: (files: ReadonlyMap<string, string>) => Promise<CompileVerdict>;
  attempt: (model: string, deadline: number) => Promise<BuilderResult>;
}) {
  const { route, files, compile, emit } = input;
  const multiStage = MULTI_STAGE_CLASSES.has(route.class), checkpoint = files.checkpoint();
  return runRouted({ route, stage: input.stage, spend: input.spend, deadline: input.deadline, singlePass: !multiStage, signal: input.signal, emit, attempt: input.attempt,
    failed: async attempted => {
      if (attempted.finished) return null;
      if (!multiStage) return attempted.stopped ? `stopped (${attempted.stopped}) before passing the finish checks` : "did not pass the finish checks";
      if (!files.changed.size) return "no usable change";
      try { files.toSource(); } catch { return "invalid project source"; }
      return (await compile(files.files)).status === "failed" ? "progress does not compile" : null;
    },
    reset: () => {
      const changed = files.restore(checkpoint);
      for (const path of changed.deleted) emit({ type: "delete", path });
      for (const path of changed.written) emit({ type: "file", path, op: "write", content: files.files.get(path)! });
    } });
}
