import { createHash } from "node:crypto";

/**
 * Deterministic art-direction starting points for a first build without a
 * preset, plan or brand palette. Measured generations converged on one look
 * (65% type-as-image first screens, one pairing on 6 of 20 sites, a mono
 * eyebrow label and a coloured phrase in nearly every headline). The seed
 * spreads first-screen archetype, type pairing, ground, headline device and
 * signature motion across projects, inside what suits the business. It is
 * advice in the user turn, never a rule: the brief, an approved plan, a
 * requested style or a brand kit always win.
 */

export type Industry = "food" | "saas" | "professional" | "creator" | "commerce" | "wellness" | "trades" | "property" | "events" | "civic" | "general";
type Weighted<T> = readonly (readonly [T, number])[];
type Pairing = readonly [display: string, text: string];

const INDUSTRY_PATTERNS: readonly (readonly [Industry, RegExp])[] = [
  ["food", /\b(?:restaurant|caf[eé]|coffee|bakery|bakehouse|bistro|bar|kitchen|menu|chef|dining|brunch|pizza|wine|brewery|roaster[ys]?|deli|bread|pastr(?:y|ies)|sourdough)\b/i],
  ["saas", /\b(?:saas|software|app|platform|api|dashboard|startup|b2b|developer|integration|workflow tool|tracker|subscription software|ai|public beta|waitlist|sign-?up|free plan|paid plan|real time)\b/i],
  ["professional", /\b(?:law(?:yer)?|solicitors?|attorney|legal|accountan(?:t|cy)|bookkeep\w*|tax|financ\w*|consult\w*|advis\w*|audit|insurance|notary)\b/i],
  ["creator", /\b(?:portfolio|photograph\w*|illustrat\w*|designer|studio|podcast|artist|ceramic\w*|maker|newsletter|writer|author|musician|creator)\b/i],
  ["commerce", /\b(?:shop|store|e-?commerce|products?|collection|checkout|cart|ships?|shipping|merch|brand of|sell(?:ing)?|launch list)\b/i],
  ["wellness", /\b(?:dental|dentist|clinic|physio\w*|therap\w*|yoga|pilates|gym|climbing|bouldering|fitness|spa|salon|beauty|wellness|health|massage|osteopath\w*|induction|memberships?)\b/i],
  ["trades", /\b(?:plumb\w*|heating|hvac|electric\w*|roof\w*|garage|auto repair|mechanic|builder|carpent\w*|landscap\w*|cleaning|removals?|locksmith|repair shop|contractor|brakes|diagnostics|warranty|bays?)\b/i],
  ["property", /\b(?:architect\w*|interior\w*|real estate|estate agent|property|apartments?|homes?|hotel|guesthouse|villa|holiday let|renovat\w*|rooms?|check-in|check-out|farmhouse)\b/i],
  ["events", /\b(?:events?|club night|venue|gig|concert|festival|wedding\w*|tickets?|line-?up|dj|band|nightlife|party)\b/i],
  ["civic", /\b(?:charity|non-?profit|volunteer\w*|pantry|food bank|community|school|club for|council|library|donat\w*|mutual aid|church|association)\b/i],
];

/** Most keyword hits wins; the opening sentence (what the business is) counts three times (ties: list order). */
export function detectIndustry(text: string): Industry {
  const opening = /^[^.!?\n]*/.exec(text)?.[0] ?? "";
  let best: Industry = "general", score = 0;
  for (const [industry, pattern] of INDUSTRY_PATTERNS) {
    const count = (value: string) => value.match(new RegExp(pattern.source, "gi"))?.length ?? 0;
    const hits = count(text) + 2 * count(opening);
    if (hits > score) { best = industry; score = hits; }
  }
  return best;
}

export const ARCHETYPES = ["Photographic", "Type as image", "Editorial split", "Poster", "Product stage", "Index"] as const;
type Archetype = typeof ARCHETYPES[number];
/** Type as image was 65% of measured first screens: it stays available but rarely suggested. */
const ARCHETYPE_WEIGHTS: Record<Industry, Weighted<Archetype>> = {
  food: [["Photographic", 4], ["Editorial split", 3], ["Index", 2], ["Poster", 2], ["Type as image", 1]],
  saas: [["Product stage", 5], ["Editorial split", 2], ["Index", 1], ["Type as image", 1]],
  professional: [["Editorial split", 4], ["Index", 3], ["Photographic", 2], ["Type as image", 1]],
  creator: [["Index", 4], ["Poster", 3], ["Photographic", 2], ["Type as image", 1]],
  commerce: [["Product stage", 4], ["Photographic", 3], ["Poster", 2], ["Editorial split", 2]],
  wellness: [["Photographic", 4], ["Editorial split", 3], ["Index", 2], ["Type as image", 1]],
  trades: [["Poster", 3], ["Photographic", 3], ["Editorial split", 2], ["Index", 2]],
  property: [["Photographic", 4], ["Editorial split", 3], ["Index", 2], ["Type as image", 1]],
  events: [["Poster", 4], ["Index", 3], ["Photographic", 2], ["Type as image", 1]],
  civic: [["Editorial split", 3], ["Photographic", 3], ["Poster", 2], ["Index", 2]],
  general: [["Editorial split", 3], ["Photographic", 2], ["Poster", 2], ["Index", 2], ["Product stage", 1], ["Type as image", 1]],
};
const ARCHETYPE_NOTES: Record<Archetype, string> = {
  "Photographic": "a full-bleed image carries the first screen; the headline sits on a solid panel or a scrim, with a details bar on its edge",
  "Type as image": "the headline fills the width and one cropped image or object is set into or against the type",
  "Editorial split": "an asymmetric 7/5 or 5/7 split, the visual bleeding off the viewport edge, a compact details column",
  "Poster": "one colour-flooded field, condensed or wide display type and a single bold graphic or image",
  "Product stage": "a crafted product UI mock or product shot on a tinted plinth, the headline beside or above it",
  "Index": "the services, menu, works or dates listed as large linked rows that are the first screen",
};

/** Library pairings per industry (display, text); at most two families. */
const PAIRINGS: Record<Industry, readonly Pairing[]> = {
  food: [["DM Serif Display", "DM Sans"], ["Fraunces", "Manrope"], ["Playfair Display", "Plus Jakarta Sans"], ["Bricolage Grotesque", "Geist"], ["Instrument Serif", "Outfit"]],
  saas: [["Geist", "JetBrains Mono"], ["Sora", "Geist"], ["Space Grotesk", "Geist"], ["Plus Jakarta Sans", "JetBrains Mono"], ["Instrument Serif", "Geist"]],
  professional: [["Newsreader", "Manrope"], ["Instrument Serif", "Geist"], ["Cormorant", "Plus Jakarta Sans"], ["Playfair Display", "DM Sans"], ["DM Serif Display", "Geist"]],
  creator: [["Syne", "Space Grotesk"], ["Instrument Serif", "Space Grotesk"], ["Bricolage Grotesque", "DM Sans"], ["Unbounded", "Geist"], ["Archivo", "JetBrains Mono"]],
  commerce: [["Bricolage Grotesque", "Plus Jakarta Sans"], ["Syne", "DM Sans"], ["DM Serif Display", "Outfit"], ["Sora", "Manrope"], ["Playfair Display", "Geist"]],
  wellness: [["Fraunces", "DM Sans"], ["Cormorant", "Manrope"], ["Instrument Serif", "Plus Jakarta Sans"], ["Outfit", "Outfit"], ["DM Serif Display", "Manrope"]],
  trades: [["Archivo", "Archivo"], ["Bebas Neue", "Outfit"], ["Space Grotesk", "Manrope"], ["Sora", "DM Sans"], ["Unbounded", "Geist"]],
  property: [["Instrument Serif", "Geist"], ["Cormorant", "Manrope"], ["Newsreader", "Space Grotesk"], ["Playfair Display", "Plus Jakarta Sans"], ["Syne", "Geist"]],
  events: [["Bebas Neue", "Space Grotesk"], ["Unbounded", "Manrope"], ["Syne", "Geist"], ["Archivo", "JetBrains Mono"], ["Cormorant", "Outfit"]],
  civic: [["Bricolage Grotesque", "Manrope"], ["Fraunces", "Geist"], ["Sora", "DM Sans"], ["DM Serif Display", "Plus Jakarta Sans"], ["Outfit", "Newsreader"]],
  general: [["Instrument Serif", "Geist"], ["Space Grotesk", "Manrope"], ["Syne", "DM Sans"], ["Newsreader", "Outfit"], ["Bricolage Grotesque", "Geist"]],
};

type Ground = "dark" | "colour flood" | "mid-tone" | "cool light" | "warm light" | "photographic";
const GROUND_NOTES: Record<Ground, string> = {
  "dark": "a deep tinted dark ground (not pure black) with light text",
  "colour flood": "one saturated hue from the subject as the ground of the first screen",
  "mid-tone": "a muted mid-value ground (clay, slate, sage, ochre, denim) with dark or light text at AA contrast",
  "cool light": "a cool tinted off-white or pale tint, never pure #fff",
  "warm light": "a warm tinted light ground, but not the default cream: push it toward stone, blush, butter or sand",
  "photographic": "the image is the ground of the first screen",
};
const GROUNDS: Record<Industry, Weighted<Ground>> = {
  food: [["photographic", 3], ["dark", 2], ["colour flood", 2], ["mid-tone", 2], ["warm light", 1]],
  saas: [["cool light", 3], ["dark", 3], ["colour flood", 1], ["mid-tone", 1]],
  professional: [["cool light", 2], ["dark", 2], ["mid-tone", 2], ["warm light", 1]],
  creator: [["colour flood", 3], ["dark", 2], ["cool light", 2], ["mid-tone", 1]],
  commerce: [["colour flood", 3], ["mid-tone", 2], ["photographic", 2], ["cool light", 1]],
  wellness: [["mid-tone", 3], ["photographic", 2], ["cool light", 2], ["warm light", 1]],
  trades: [["dark", 3], ["colour flood", 2], ["cool light", 2], ["photographic", 1]],
  property: [["photographic", 3], ["mid-tone", 2], ["cool light", 2], ["dark", 1]],
  events: [["dark", 3], ["colour flood", 3], ["photographic", 1]],
  civic: [["colour flood", 2], ["cool light", 2], ["mid-tone", 2], ["photographic", 1]],
  general: [["cool light", 2], ["mid-tone", 2], ["dark", 2], ["colour flood", 1]],
};

const HEADLINE_DEVICES = [
  "weight contrast: one line in a heavy weight against a light one, same colour",
  "scale contrast: one word, numeral or date set far larger than the rest",
  "a solid colour block behind one short phrase (text on it at AA contrast)",
  "a drawn rule or thick underline under one phrase",
  "no accent at all: size, measure and spacing carry the headline",
  "a split headline: a small set-up line, then the claim at full display size",
] as const;
const SIGNATURE_MOTION = [
  "image wipes: hero-adjacent and section images reveal with data-reveal=\"wipe\" (clip-path) as they enter",
  "scroll-linked depth: one or two large images drift slowly inside clipped frames (data-depth)",
  "a sticky scroll story: a pinned visual or heading while numbered steps scroll past and the active step is highlighted",
  "an index that performs: large linked rows slide in with a stagger and reveal a preview or detail on hover and focus",
  "a reading-progress rule in the header (data-progress) plus staggered rises on lists and figures",
  "a slow marquee band of real details (services, dates, places), paused under reduced motion",
] as const;
const COMPOSITIONS = [
  "an editorial asymmetric split with a bleeding image", "a bento grid of unequal cells", "layered, overlapping imagery with a caption card",
  "a sticky scroll story", "an index list with large numerals", "a full-bleed band with an overlaid headline", "a printed-card price or menu list",
  "a numbered process on a timeline", "a stat band of facts from the brief", "a split call-to-action footer",
] as const;

/** Bytes of a stable digest of the seed text (one byte per choice). */
function digest(seed: string) {
  return createHash("sha256").update(`makeborne-design-seed-v1:${seed}`).digest();
}
function pick<T>(options: Weighted<T>, byte: number): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let point = (byte / 256) * total;
  for (const [option, weight] of options) { if ((point -= weight) < 0) return option; }
  return options[options.length - 1][0];
}

export type DesignSeed = { industry: Industry; archetype: Archetype; pairing: Pairing; ground: Ground; headline: string; motion: string; compositions: [string, string] };

export function designSeed(input: { seed: string; brief: string; images: boolean }): DesignSeed {
  const industry = detectIndustry(input.brief);
  const bytes = digest(input.seed);
  const archetypes = ARCHETYPE_WEIGHTS[industry].filter(([name]) => input.images || name !== "Photographic");
  const grounds = GROUNDS[industry].filter(([name]) => input.images || name !== "photographic");
  const pairings = PAIRINGS[industry];
  const first = bytes[5] % COMPOSITIONS.length;
  let second = bytes[6] % COMPOSITIONS.length;
  if (second === first) second = (second + 1) % COMPOSITIONS.length;
  return {
    industry,
    archetype: pick(archetypes, bytes[0]),
    pairing: pairings[bytes[1] % pairings.length],
    ground: pick(grounds, bytes[2]),
    headline: HEADLINE_DEVICES[bytes[3] % HEADLINE_DEVICES.length],
    motion: SIGNATURE_MOTION[bytes[4] % SIGNATURE_MOTION.length],
    compositions: [COMPOSITIONS[first], COMPOSITIONS[second]],
  };
}

/** The user-turn block for a first build. */
export function designSeedBlock(input: { seed: string; brief: string; images: boolean; brand?: boolean }) {
  const seed = designSeed(input);
  const [display, text] = seed.pairing;
  return [
    "<design_seed>",
    "Starting points for this project's art direction, chosen per project so Makeborne sites do not converge on one look. Use them unless they clearly conflict with the brief; the brief, an approved plan, a requested style" + (input.brand ? " and the brand kit (its colours and fonts)" : "") + " always win. If you change one, choose something just as specific and say why in finish.design.",
    `- First screen: ${seed.archetype} (${ARCHETYPE_NOTES[seed.archetype]}).`,
    `- Type: "${display}"${display === text ? " for display and text (vary weight, width and size)" : ` for display, "${text}" for text`}.`,
    `- Ground: ${seed.ground}: ${GROUND_NOTES[seed.ground]}. Derive the exact hues from this business.`,
    `- Headline device: ${seed.headline}.`,
    `- Signature motion: ${seed.motion}.`,
    `- Feature these compositions somewhere on the page: ${seed.compositions[0]}; ${seed.compositions[1]}.`,
    "</design_seed>",
  ].join("\n");
}
