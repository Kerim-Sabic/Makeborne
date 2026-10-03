export type CreationPlanInput = { kind: "website" | "book" | "presentation"; title: string; brief: string; audience: string; purpose: string; requirements: string; style: string; outline?: string | null };
export function creationPlan(input: CreationPlanInput) {
  if (input.outline && input.outline.length > 2000) throw new Error("Keep the proposed structure within 2,000 characters.");
  const structure = input.outline != null ? input.outline.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : {
    website: ["Opening: audience, promise, and primary action", "Offer: scope, process, and practical details", "Proof: only supplied and approved evidence", "Contact or next step with clear expectations"],
    book: ["Cover and introduction: promise and reader context", "Core chapters: concepts in a logical learning sequence", "Application: examples, exercises, or checklists", "Closing: recap, references, and next steps"],
    presentation: ["Opening: audience problem and intended outcome", "Core argument or lesson, one idea per slide", "Examples and evidence from supplied material", "Close: takeaway and clear next action"],
  }[input.kind];
  return { structure, checks: ["Review all factual claims and sources", "Check readability, contrast, and content fit", "Confirm required sections and approved assets", "Review the exported result before sharing"], brief: [input.brief, "APPROVED PROJECT PLAN", "Audience and intended outcome are recorded in the project fields.", `Creative direction: ${input.style}`, `Requirements and exclusions: ${input.requirements || "No additional requirements supplied."}`, "Approved structure:", structure.map(item => `- ${item}`).join("\n"), "Planning method: local structured outline, not live AI analysis. Approval covers this starting plan; generation, deployment, and charges require separate available services."].join("\n\n") };
}
