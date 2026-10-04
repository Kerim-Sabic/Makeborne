export type FollowUpBucket = "overdue" | "today" | "upcoming" | "unscheduled" | "closed";
type Summary = { stage: string; nextFollowUp: string | null };
export function localCalendarDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function followUpBucket(summary: Summary | undefined, today: string): FollowUpBucket {
  if (summary?.stage === "Won" || summary?.stage === "Lost") return "closed";
  if (!summary?.nextFollowUp) return "unscheduled";
  return summary.nextFollowUp < today ? "overdue" : summary.nextFollowUp === today ? "today" : "upcoming";
}
export function followUpLabel(summary: Summary | undefined, today: string) {
  const bucket = followUpBucket(summary, today);
  if (bucket === "closed") return summary?.nextFollowUp ? `Closed · ${summary.nextFollowUp}` : "Closed";
  if (bucket === "unscheduled") return "No follow-up set";
  if (bucket === "today") return "Due today";
  return `${bucket === "overdue" ? "Overdue" : "Follow up"} · ${summary!.nextFollowUp}`;
}
