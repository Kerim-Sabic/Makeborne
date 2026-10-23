import type { StoredPlan } from "../builder/plan";
import type { ApprovedFacts, Brief } from "./contract";
import { NO_FACTS } from "./reviewer";

/**
 * The approved brief for a review: the project brief the customer wrote,
 * plus, when the customer approved a site plan and it was built, that plan's
 * pages and sections as citable requirements. A draft plan is not approved
 * and is not used.
 */
export function reviewBrief(input: { projectId: string; brief: string; plan: StoredPlan | null }): { brief: Brief; declaredRoutes: string[] } {
  const plan = input.plan?.status === "built" ? input.plan : null;
  const requirements: Brief["requirements"] = [];
  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "home";
  for (const page of plan?.plan.pages ?? []) {
    const id = `page-${slug(page.path === "/" ? "home" : page.path)}`;
    requirements.push({ id, text: `Page ${page.name} (${page.path}): ${page.purpose}`.slice(0, 400) });
    page.sections.forEach((section, index) => requirements.push({ id: `${id}-s${index + 1}`.slice(0, 48), text: `${page.name} section "${section.name}": ${section.purpose}`.slice(0, 400) }));
  }
  const summary = (input.brief.trim() || plan?.plan.summary || "").slice(0, 2000);
  return {
    brief: { id: `project-${input.projectId}`.slice(0, 64), version: plan?.revision ?? 0, approved: true, summary, requirements: requirements.slice(0, 40) },
    declaredRoutes: plan?.plan.pages.map(page => page.path) ?? [],
  };
}

/** Until the knowledge module supplies approved facts, the review runs with none: factual claims are not checked (and say so). */
export const NO_APPROVED_FACTS: ApprovedFacts = Object.freeze({ snapshotId: NO_FACTS, facts: [] });
