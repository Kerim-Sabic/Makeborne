/**
 * "Needs attention": open deals that are overdue, have no next step, or have
 * sat in one stage too long (Pipedrive's "rotting", Close's "needs attention").
 * Pure: computed from the stage, the follow-up date and the outreach activity
 * log the CRM already keeps. Nothing is written.
 */
export type ActivityEntry = { at: string; text: string; type?: string };
export type PipelineClient = {
  id: string; name: string; company?: string | null; createdAt?: string | null; updatedAt?: string | null;
  outreach?: { stage?: string; nextFollowUp?: string | null; lastContact?: string | null; activity?: ActivityEntry[] } | null;
  nextStep?: string | null;
};
export type AttentionKind = "overdue" | "no_next_step" | "stalled";
export type Attention = { kind: AttentionKind; text: string; days: number | null };

export const OPEN_STAGES = ["Lead", "Contacted", "Conversation", "Proposal"] as const;
/** Days in a stage before a deal counts as stalled (no stage change and no logged contact). */
export const STALL_DAYS: Readonly<Record<string, number>> = Object.freeze({ Lead: 21, Contacted: 10, Conversation: 14, Proposal: 10 });

const DAY = 86_400_000;
const dayOf = (iso: string) => iso.slice(0, 10);
const daysBetween = (from: string, to: string) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${dayOf(from)}T00:00:00Z`)) / DAY);

/** When the client entered its current stage (the last "Stage: A → B" entry), else when it was created. */
export function stageSince(client: PipelineClient): string | null {
  const stage = client.outreach?.stage ?? "Lead";
  const entries = client.outreach?.activity ?? [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const match = /Stage: [^→]+→\s*([A-Za-z]+)/.exec(entries[index].text);
    if (match && match[1] === stage) return entries[index].at;
  }
  return client.createdAt ?? entries[0]?.at ?? null;
}
/** The latest sign of life: a logged contact, any outreach entry, or the last contact date. */
export function lastTouch(client: PipelineClient): string | null {
  const entries = client.outreach?.activity ?? [];
  const latest = entries.reduce<string | null>((best, entry) => !best || entry.at > best ? entry.at : best, null);
  const contact = client.outreach?.lastContact ?? null;
  return [latest, contact, stageSince(client)].filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

export function attentionFor(client: PipelineClient, today: string, stall: Readonly<Record<string, number>> = STALL_DAYS): Attention[] {
  const stage = client.outreach?.stage ?? "Lead";
  if (!(OPEN_STAGES as readonly string[]).includes(stage)) return [];
  const out: Attention[] = [];
  const due = client.outreach?.nextFollowUp ?? null;
  if (due && due < today) { const days = daysBetween(due, today); out.push({ kind: "overdue", text: `Follow-up was due ${days} day${days === 1 ? "" : "s"} ago${client.nextStep ? `: ${client.nextStep}` : ""}`, days }); }
  if (!due) out.push({ kind: "no_next_step", text: "No follow-up date: decide the next step", days: null });
  const touched = lastTouch(client), limit = stall[stage];
  if (touched && limit) {
    const days = daysBetween(touched, today);
    if (days >= limit) out.push({ kind: "stalled", text: `${days} days in ${stage} with no logged activity`, days });
  }
  return out;
}

const WEIGHT: Record<AttentionKind, number> = { overdue: 3, stalled: 2, no_next_step: 1 };
/** Clients needing attention, most urgent first (overdue longest, then stalled longest). */
export function needsAttention(clients: readonly PipelineClient[], today: string, limit = 50) {
  return clients.map(client => ({ client, items: attentionFor(client, today) })).filter(entry => entry.items.length)
    .map(entry => ({ ...entry, urgency: entry.items.reduce((sum, item) => sum + WEIGHT[item.kind] * 1000 + (item.days ?? 0), 0) }))
    .sort((a, b) => b.urgency - a.urgency || a.client.name.localeCompare(b.client.name)).slice(0, limit)
    .map(entry => ({ id: entry.client.id, name: entry.client.name, company: entry.client.company ?? "", stage: entry.client.outreach?.stage ?? "Lead", nextFollowUp: entry.client.outreach?.nextFollowUp ?? null, nextStep: entry.client.nextStep ?? "", items: entry.items }));
}

export const NEXT_STEP_MAX = 200;
export function cleanNextStep(raw: string) { return raw.replace(/[<>\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NEXT_STEP_MAX); }
