export const EXPERT_IDS = ["mira", "nova", "rex", "juno", "theo", "atlas", "ellis", "sage"] as const;
export type ExpertId = typeof EXPERT_IDS[number];

export type ExpertPersona = {
  id: ExpertId;
  name: string;
  specialty: string;
  description: string;
  introduction: string;
  /** What this expert advises on, shown so people know whom to ask. */
  covers: readonly string[];
  /** One-click starting questions. */
  starters: readonly string[];
  /** Whether /advisors/{id}-transparent.png exists; otherwise a lettered avatar is shown. */
  portrait: boolean;
};

export const EXPERT_PERSONAS: readonly ExpertPersona[] = [
  {
    id: "mira", name: "Mira", specialty: "Positioning & brand", portrait: true,
    description: "Find your angle. Stand for something specific.",
    introduction: "A sharper position starts with a better question.",
    covers: ["Positioning and differentiation", "Ideal client definition", "Messaging and value propositions", "Brand voice and storytelling", "Names and taglines"],
    starters: ["How should I position my studio against cheaper freelancers?", "Who should my ideal client be if I build websites for local businesses?", "Give my brand a clear voice in three sentences."],
  },
  {
    id: "nova", name: "Nova", specialty: "Copywriting", portrait: true,
    description: "Words that make people act.",
    introduction: "Say it so the right person can't ignore it.",
    covers: ["Headlines and website copy", "Landing and sales pages", "Newsletters and marketing emails", "Social posts and ad copy", "Calls to action and microcopy"],
    starters: ["Write five headlines for a booking website for dentists.", "Rewrite my About page so it sells without bragging.", "Turn this feature list into benefits a client cares about."],
  },
  {
    id: "rex", name: "Rex", specialty: "Sales & outreach", portrait: true,
    description: "Start conversations that turn into clients.",
    introduction: "Every client starts with one good message.",
    covers: ["Prospect lists and triggers", "Cold and warm outreach", "Follow-up sequences", "Discovery calls and proposals", "Objections and closing"],
    starters: ["Write a cold email to a restaurant whose website is broken on mobile.", "Build a 5-step follow-up sequence that never says “just checking in”.", "A prospect says “too expensive”. How do I answer?"],
  },
  {
    id: "juno", name: "Juno", specialty: "Offers & pricing", portrait: true,
    description: "Package your work so it's easy to say yes.",
    introduction: "A great offer makes selling feel easy.",
    covers: ["Offer design and packaging", "Pricing and tiers", "Guarantees and risk reversal", "Retainers and care plans", "Discounts and deposits"],
    starters: ["Price my website service as three packages.", "Should I charge hourly or per project?", "Design a monthly care plan clients actually want."],
  },
  {
    id: "theo", name: "Theo", specialty: "Growth & launches", portrait: true,
    description: "Get seen by the right people, then convert them.",
    introduction: "Growth is a system, not a lucky post.",
    covers: ["Launch plans", "Channels: social, SEO, communities, partners", "Ads: angles, hooks, testing", "Funnels and conversion", "Marketing metrics"],
    starters: ["Plan a two-week launch for a new service with no ad budget.", "Which channel should I focus on first as a solo web designer?", "My landing page gets visits but no sign-ups. Where do I look?"],
  },
  {
    id: "atlas", name: "Atlas", specialty: "Research & insight", portrait: true,
    description: "Explore the evidence behind an idea.",
    introduction: "Turn a promising question into a useful investigation.",
    covers: ["Customer and market research plans", "Interview guides and surveys", "Making sense of feedback and data", "Competitor and alternative analysis", "Testing assumptions before you invest"],
    starters: ["Design five customer interviews to test if dentists want a booking site.", "How do I size the market for a local bike-repair app?", "What's the fastest way to check this idea before I build it?"],
  },
  {
    id: "ellis", name: "Ellis", specialty: "Product & strategy", portrait: true,
    description: "Choose what to build, and what matters first.",
    introduction: "Make the next thing worth building.",
    covers: ["What to build first and what to cut", "Roadmaps and prioritisation", "Scoping an MVP", "Success metrics and goals", "Business model and strategic trade-offs"],
    starters: ["I have six feature ideas. Help me pick the first two.", "Scope a first version of a product I can ship in three weeks.", "Which metrics should I watch in the first month after launch?"],
  },
  {
    id: "sage", name: "Sage", specialty: "Client delivery & operations", portrait: true,
    description: "Deliver smoothly and keep clients coming back.",
    introduction: "Happy clients come from a calm process.",
    covers: ["Client onboarding and scoping", "Timelines, revisions and scope creep", "Handover and care plans", "Client communication", "Processes, templates and contractors"],
    starters: ["Create an onboarding checklist for a new website client.", "A client keeps asking for “small changes”. How do I handle it?", "Plan a handover that turns into a monthly retainer."],
  },
];

export type ChatMode = "standard" | "genius";
/**
 * Chat is billed at a multiple of the provider's cost; the hold is the most one answer can charge.
 * Credits are charged in whole numbers until fractional credits ship.
 */
export const CHAT_MODES: Readonly<Record<ChatMode, { label: string; summary: string; holdCredits: number; priceMultiplier: number }>> = {
  standard: { label: "Standard", summary: "Fast, focused advice. Usually under 1 credit per answer, never more than 3.", holdCredits: 3, priceMultiplier: 15 },
  // Opus costs far more per token than Haiku; a low multiple keeps a Genius answer at a few Standard answers.
  genius: { label: "Genius", summary: "Our strongest model for hard decisions. Usually 2–4 credits per answer, never more than 15.", holdCredits: 15, priceMultiplier: 1.5 },
};

/** Conversation limits enforced by the server; the browser mirrors them. */
export const EXPERT_CHAT_LIMITS = {
  messageCharacters: 6000,
  historyMessages: 24,
  historyCharacters: 60000,
} as const;
