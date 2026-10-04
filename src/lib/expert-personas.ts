export type ExpertId = "mira" | "atlas" | "ellis";

export type ExpertPersona = {
  id: ExpertId;
  name: string;
  specialty: string;
  description: string;
  introduction: string;
};

export const EXPERT_PERSONAS: readonly ExpertPersona[] = [
  {
    id: "mira", name: "Mira", specialty: "Marketing & positioning",
    description: "Find your angle. Make your offer clear.",
    introduction: "A sharper offer starts with a better question.",
  },
  {
    id: "atlas", name: "Atlas", specialty: "Research & insight",
    description: "Explore the evidence behind an idea.",
    introduction: "Turn a promising question into a useful investigation.",
  },
  {
    id: "ellis", name: "Ellis", specialty: "Product & strategy",
    description: "Choose what to build, and what matters first.",
    introduction: "Make the next thing worth building.",
  },
];

/** Planned policy only. The server must enforce quotas and select an evaluated route before enabling chat. */
export const EXPERT_CHAT_POLICY = {
  status: "not_connected",
  intendedTier: "free",
  routeClass: "economy",
  maxDraftCharacters: 12000,
  provider: null,
  requiresServerQuota: true,
  requiresVerifiedPricing: true,
} as const;
