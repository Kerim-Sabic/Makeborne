import { z } from "zod";

/** Delivery of one project's work to its client, separate from the client's
 * sales stage (./client-outreach) and from the project's lifecycle status
 * (draft, published, archived…). Client review links move this stage. */
export const projectDeliveryStages = ["active", "in_review", "changes_requested", "delivered"] as const;
export const ProjectDeliveryStageSchema = z.enum(projectDeliveryStages);
export type ProjectDeliveryStage = z.infer<typeof ProjectDeliveryStageSchema>;

export const deliveryStageLabels: Record<ProjectDeliveryStage, string> = {
  active: "Active", in_review: "In review", changes_requested: "Changes requested", delivered: "Delivered",
};

/** How a project's stage was derived when delivery stages were introduced
 * (makeborne_private.crm_backfill_project_delivery in migration
 * 20261011190000 applies the same mapping to stored projects, audited):
 * the client review flow used to set status review / approved / in_progress. */
export function legacyDeliveryStage(status: string, latestReviewDecision?: "approved" | "changes_requested" | null): ProjectDeliveryStage {
  if (status === "review") return "in_review";
  if (status === "approved") return "delivered";
  if (status === "in_progress" && latestReviewDecision === "changes_requested") return "changes_requested";
  return "active";
}

/** What a client review event does to the project's delivery stage. */
export function deliveryStageAfterReview(event: "link_sent" | "approved" | "changes_requested"): ProjectDeliveryStage {
  return event === "link_sent" ? "in_review" : event === "approved" ? "delivered" : "changes_requested";
}

/** The state a cloud project list shows. projects.status keeps its lifecycle
 * meaning (draft, published, archived). The earlier client review flow also
 * wrote "review" and "approved" there; delivery now lives in deliveryStage, so
 * those stored values are never presented as the current delivery state. */
export function projectStateLabel(status: string, deliveryStage: ProjectDeliveryStage): string {
  if (status === "archived") return "Archived";
  if (deliveryStage !== "active") return deliveryStageLabels[deliveryStage];
  if (status === "published") return "Published";
  if (status === "draft") return "Draft";
  return "In progress";
}
