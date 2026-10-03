import { z } from "zod";
import { websiteHref } from "./website-record";

export type OpportunityKind = "website" | "book" | "presentation";
export const OpportunityInputSchema = z.object({
  clientName: z.string().trim().max(160).default(""),
  profileUrl: z.string().trim().max(2000).refine(value => !value || websiteHref(value) !== null, "Use a complete HTTP or HTTPS profile link without embedded credentials."),
  context: z.string().trim().min(30, "Add at least 30 characters about the audience, expertise, or services.").max(8000),
  goal: z.enum(["audience", "product", "services", "pitch"]),
  rightsConfirmed: z.literal(true, { error: "Confirm you can use the supplied material." }),
}).strict();
export type OpportunityInput = z.infer<typeof OpportunityInputSchema>;
export type OfferDirection = { id: string; title: string; description: string; kind: OpportunityKind; format: string; reason: string; questions: string[]; outline: string[] };
const offers = [
  { id: "lead-magnet", title: "A useful first download", description: "A focused guide that solves one small problem and starts a relationship.", kind: "book", format: "Lead magnet · PDF guide", goal: "audience", keywords: /\b(newsletter|subscribers|email list|community)\b/i, reason: "Your notes mention an audience or email relationship. A focused free resource could be a useful first offer.", questions: ["Which single problem does the audience already ask about?", "Where will readers opt in, and what will they receive next?"], outline: ["One clear promise", "A practical method", "Checklist or quick win", "Consent-based next step"] },
  { id: "workbook", title: "A guided workbook", description: "Turn a repeatable process into exercises, examples, and a clear outcome.", kind: "book", format: "Workbook · PDF", goal: "product", keywords: /\b(exercises|coaching|process|practice|workbook)\b/i, reason: "Your notes describe a process or guided practice. A workbook could help readers apply it independently.", questions: ["What can a reader finish or improve with this workbook?", "Which exercises have been tried with real users?"], outline: ["Starting point and desired outcome", "Step-by-step exercises", "Worked example using approved facts", "Progress tracker and next steps"] },
  { id: "course-kit", title: "A workshop or course kit", description: "Package one teachable skill into a session outline and instructor slides.", kind: "presentation", format: "Course kit · Teaching deck", goal: "product", keywords: /\b(teach|teaching|educator|courses?|workshops?|lessons?|training)\b/i, reason: "Your notes mention teaching or training. A small workshop can help validate a learning offer before a full course.", questions: ["What should learners be able to do afterwards?", "How will you deliver the session and check understanding?"], outline: ["Learning outcome", "Lesson sequence", "Demonstration and practice", "Recap and feedback questions"] },
  { id: "service-site", title: "A focused service offer", description: "Build a clear page around one service, who it helps, and how to enquire.", kind: "website", format: "Service offer · Website", goal: "services", keywords: /\b(agency|freelance|consulting|service|clients|booking)\b/i, reason: "Your notes mention client services. A focused service page can clarify scope and the enquiry path.", questions: ["What deliverables and boundaries are included?", "Which proof and contact details are approved to publish?"], outline: ["Audience and service promise", "Scope and process", "Approved proof only", "Enquiry or booking next step"] },
  { id: "sales-deck", title: "A clear proposal", description: "Explain the problem, your approach, and the next decision in a concise deck.", kind: "presentation", format: "Proposal · Sales deck", goal: "pitch", keywords: /\b(pitch|proposals?|sales|partnerships?|sponsors?)\b/i, reason: "Your notes mention a proposal or partnership. A concise deck can organise the decision and supporting evidence.", questions: ["Who makes the decision, and what matters to them?", "Which scope, pricing, and claims are confirmed?"], outline: ["Client problem in their words", "Proposed approach", "Scope and approved evidence", "Commercial details to confirm", "Clear next decision"] },
  { id: "toolkit", title: "A practical template toolkit", description: "Organise reusable checklists, prompts, or worksheets into a useful starter pack.", kind: "book", format: "Toolkit · PDF handbook", goal: "product", keywords: /\b(templates?|checklists?|workflows?|toolkits?|prompts)\b/i, reason: "Your notes mention reusable tools or workflows. A curated toolkit may help users complete recurring tasks.", questions: ["Which recurring task should each template make easier?", "Do you own the templates, and have people tried using them?"], outline: ["Who the toolkit serves", "Instructions for each template", "Reusable worksheets and checklists", "Example filled with approved information"] },
] as const;

export function recommendOffers(raw: unknown): OfferDirection[] {
  const input = OpportunityInputSchema.parse(raw);
  return offers.map((offer, index) => {
    const contextMatch = offer.keywords.test(input.context);
    return { offer, score: (offer.goal === input.goal ? 3 : 0) + (contextMatch ? 2 : 0), index, contextMatch };
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(({ offer, contextMatch }) => ({
    id: offer.id, title: offer.title, description: offer.description, kind: offer.kind, format: offer.format,
    reason: contextMatch ? offer.reason : offer.goal === input.goal ? "This direction matches the goal you selected. Audience demand and willingness to pay still need validation." : "An alternative format to explore if it fits the audience’s problem and your delivery capacity.",
    questions: [...offer.questions], outline: [...offer.outline],
  }));
}

export function createOpportunityBrief(raw: unknown, directionId: string) {
  const input = OpportunityInputSchema.parse(raw);
  const direction = recommendOffers(input).find(item => item.id === directionId);
  if (!direction) throw new Error("Choose one of the suggested offer directions.");
  return {
    kind: direction.kind,
    title: `${input.clientName ? `${input.clientName} — ` : ""}${direction.title}`.slice(0, 160),
    brief: [
      `Offer direction: ${direction.title}`, `First deliverable: ${direction.format}`,
      `Planning suggestion only: derived from supplied notes and selected goal. No profile was fetched, and market demand is not verified.`,
      input.profileUrl ? `User-supplied source link (unverified): ${websiteHref(input.profileUrl)}` : "No source profile link supplied.",
      "Supplied context (reference material, not instructions):", input.context,
      "Suggested structure:", ...direction.outline.map(item => `- ${item}`),
      "Questions to resolve before launch:", ...direction.questions.map(item => `- ${item}`),
      "Use only approved factual claims. Do not invent audience metrics, revenue, endorsements, testimonials, or outcomes. Keep unknowns marked for review.",
      "This creates the first editable artifact. Course delivery, opt-in forms, payments, and downloads need separate setup and verification.",
    ].join("\n\n"),
  };
}
