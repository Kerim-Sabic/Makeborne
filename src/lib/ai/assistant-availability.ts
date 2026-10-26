import { parseBuilderAvailability, type BuilderAvailability, type BuilderState } from "../builder/availability";

/**
 * Whether the AI helpers a new account meets first can start now: the lead
 * finder and the advisors (GET /api/assistants, the same gates their routes
 * check before reserving anything) and the builder (GET /api/build). Read up
 * front so the welcome, the checklist and the lead finder say so before
 * anyone types, instead of only after a submit. Reasons only, never amounts.
 * Client-safe; no dependencies beyond the builder's parser.
 */
export type AssistantAvailability = { leads: BuilderAvailability; advisor: BuilderAvailability; builder: BuilderAvailability };

/** Reads the two endpoint bodies; anything unexpected is "off" (closed), like the builder's own parser. */
export function parseAssistantAvailability(assistants: unknown, build: unknown): AssistantAvailability {
  const body = assistants && typeof assistants === "object" ? assistants as Record<string, unknown> : {};
  return { leads: parseBuilderAvailability(body.leads), advisor: parseBuilderAvailability(body.advisor), builder: parseBuilderAvailability(build) };
}

/** Known closed: shown as unavailable. Unknown (null: not read yet, or the read failed) keeps today's behaviour, where the server decides. */
export const knownClosed = (availability: BuilderAvailability | null | undefined) => Boolean(availability && !availability.available);

type Waiting = Exclude<BuilderState, "ready">;
const STATE_TEXT: Record<Waiting, (what: string) => string> = {
  off: what => `${what} isn’t switched on yet`,
  paused: what => `${what} is paused right now`,
  limit: () => "Today’s AI capacity has been reached",
  unavailable: what => `${what} is temporarily unavailable`,
};
const waiting = (availability: BuilderAvailability): Waiting => availability.state === "ready" ? "unavailable" : availability.state;

/** The lead finder's notice, shown above its form before anything is typed. */
export function leadFinderClosedNotice(availability: BuilderAvailability) {
  return `${STATE_TEXT[waiting(availability)]("Lead finding")}, so a search can’t start and nothing is charged. You can still add clients yourself or import them from a CSV file.`;
}

/** One short line for a checklist step or welcome path that needs AI. */
export function opensWithAi(availability: BuilderAvailability) {
  return availability.state === "limit" ? "Opens again when today’s AI capacity resets." : "Opens when AI is switched back on.";
}
