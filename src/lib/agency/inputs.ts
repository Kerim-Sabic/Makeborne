import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { billingDatabase } from "../billing/database";
import type { AgencyTask } from "./task";
import { TaskStop, type AgencyTool } from "./loop";

/**
 * Reads a task's bound inputs, by index only, inside the task's workspace and
 * at the exact digest recorded with the operation. A changed or missing input
 * is refused (the next step is refused in SQL too). Assets are described, not
 * sent: image inputs need their own priced path and are not part of this step.
 */
export const MAX_INPUT_CHARS = 60_000;
export function inputReader(task: AgencyTask) {
  return async (index: number): Promise<string> => {
    const input = Number.isSafeInteger(index) ? task.inputs[index] : undefined;
    if (!input) throw new Error("No such input.");
    const db = billingDatabase();
    if (input.kind === "source") {
      const { data, error } = await db.from("sources").select("content").eq("id", input.id).eq("workspace_id", task.workspaceId).eq("project_id", input.projectId).maybeSingle();
      if (error || typeof data?.content !== "string") throw new Error("Input unavailable.");
      if (createHash("sha256").update(data.content, "utf8").digest("hex") !== input.sha256) throw new TaskStop("INPUT_CHANGED", "An input changed during the task; it stopped.");
      return data.content.slice(0, MAX_INPUT_CHARS);
    }
    if (input.kind === "asset") {
      const { data, error } = await db.from("assets").select("content_type,sha256").eq("id", input.id).eq("workspace_id", task.workspaceId).eq("project_id", input.projectId).maybeSingle();
      if (error || !data || data.sha256 !== input.sha256) throw new Error("Input unavailable.");
      return JSON.stringify({ asset: input.id, contentType: data.content_type, sha256: input.sha256, note: "Image content is not included in this step." });
    }
    const { data, error } = await db.from("artifact_versions").select("content,version_number").eq("id", input.id).eq("workspace_id", task.workspaceId).maybeSingle();
    if (error || !data || data.version_number !== input.version) throw new Error("Input unavailable.");
    return JSON.stringify(data.content).slice(0, MAX_INPUT_CHARS);
  };
}

/** The one shared read tool every kind may be granted. */
export const readInputTool: AgencyTool<{ index: number }> = Object.freeze({
  name: "read_input", effect: "read" as const,
  description: "Read one of this task's inputs by its index (0-based). Returns its text, or a description for images.",
  args: z.object({ index: z.number().int().min(0).max(49) }).strict(),
  run: (args: { index: number }, context: { readInput(index: number): Promise<string> }) => context.readInput(args.index),
});
