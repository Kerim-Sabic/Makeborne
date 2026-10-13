"use client";
import type { CloudClient } from "@/lib/cloud/contracts";
import { emptyOutreach, saveOutreach, type ClientOutreach, type OutreachStage } from "@/lib/client-outreach";
import { localCalendarDay } from "@/lib/client-followups";
import { api } from "./cloud-api";

/** A one-click change to a client's outreach, recorded in its history like an edit in the outreach panel. */
export type QuickChange =
  | { kind: "stage"; stage: OutreachStage }
  | { kind: "contacted"; nextFollowUp: string | null; note?: string }
  | { kind: "snooze"; nextFollowUp: string };

export const addDays = (day: string, days: number) => {
  const [year, month, date] = day.split("-").map(Number);
  return localCalendarDay(new Date(year, month - 1, date + days));
};
/** The next Monday after `day` (or a week later when `day` is a Monday). */
export const nextMonday = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(year, month - 1, date).getDay();
  return addDays(day, ((8 - weekday) % 7) || 7);
};

export function applyQuickChange(outreach: ClientOutreach | undefined, change: QuickChange, today: string) {
  const current = outreach ?? emptyOutreach();
  const entry = { id: crypto.randomUUID(), at: new Date().toISOString() };
  if (change.kind === "stage") return saveOutreach(outreach, { ...current, stage: change.stage }, entry);
  if (change.kind === "snooze") return saveOutreach(outreach, { ...current, nextFollowUp: change.nextFollowUp }, { ...entry, text: `Follow-up moved to ${change.nextFollowUp}`, type: "update" });
  // Contacted: logs the contact, records today, and moves a new lead along.
  const stage = current.stage === "Lead" ? "Contacted" : current.stage;
  return saveOutreach(outreach, { ...current, stage, lastContact: today, nextFollowUp: change.nextFollowUp },
    { ...entry, text: [change.note?.trim().slice(0, 1700), change.nextFollowUp ? `Next follow-up ${change.nextFollowUp}` : ""].filter(Boolean).join("\n\n") || "Contact made", type: "contact" });
}

/** Reads the latest record, applies the change and saves it with conflict protection. One automatic retry on a concurrent edit. */
export async function quickUpdate(workspaceId: string, clientId: string, change: QuickChange, today = localCalendarDay(new Date())): Promise<CloudClient> {
  for (let attempt = 0; ; attempt++) {
    const { client } = await api<{ client: CloudClient }>(`/api/cloud/workspaces/${workspaceId}/clients/${clientId}`);
    const outreach = applyQuickChange(client.outreach, change, today);
    try {
      return (await api<{ client: CloudClient }>(`/api/cloud/workspaces/${workspaceId}/clients/${clientId}`, { outreach, expectedUpdatedAt: client.updatedAt }, "PATCH")).client;
    } catch (error) {
      if (attempt === 0 && (error as { status?: number }).status === 409) continue;
      throw error;
    }
  }
}

export const summaryOf = (client: CloudClient) => client.outreach ? { stage: client.outreach.stage, nextFollowUp: client.outreach.nextFollowUp } : client.outreachSummary;
