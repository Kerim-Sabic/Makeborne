import { createHash } from "node:crypto";
import type { DesignAnswers } from "./brief-questions";

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

export type Industry = "food" | "saas" | "professional" | "creator" | "commerce" | "wellness" | "trades" | "property" | "events" | "weddings" | "civic" | "general";
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
  ["events", /\b(?:events?|club night|venue|gig|concert|festival|tickets?|line-?up|dj|band|nightlife|party)\b/i],
  // Weddings want elegance, not poster energy: a wedding planner seeded as "events" read like a club night.
  ["weddings", /\b(?:wedding\w*|elopements?|bridal|brides?|grooms?|ceremon(?:y|ies)|honeymoon|engagements?)\b/i],
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
/** Round 3: fewer photographic seeds had moved 4 of 7 first screens into Editorial split (D4/D5 fell to
 * 0.695), so the weights are flatter: three or four archetypes per industry at similar odds. */
const ARCHETYPE_WEIGHTS: Record<Industry, Weighted<Archetype>> = {
  food: [["Editorial split", 2], ["Poster", 2], ["Index", 2], ["Photographic", 2], ["Product stage", 1], ["Type as image", 1]],
  saas: [["Product stage", 4], ["Editorial split", 2], ["Index", 1], ["Type as image", 1], ["Poster", 1]],
  professional: [["Editorial split", 2], ["Index", 2], ["Poster", 2], ["Type as image", 1]],
  creator: [["Index", 3], ["Poster", 2], ["Type as image", 2], ["Editorial split", 1], ["Photographic", 1]],
  commerce: [["Product stage", 3], ["Poster", 2], ["Photographic", 2], ["Editorial split", 1], ["Index", 1]],
  wellness: [["Editorial split", 2], ["Index", 2], ["Type as image", 1], ["Poster", 1], ["Photographic", 1]],
  trades: [["Poster", 3], ["Index", 2], ["Editorial split", 2], ["Type as image", 1], ["Photographic", 1]],
  property: [["Editorial split", 2], ["Index", 2], ["Photographic", 2], ["Type as image", 1]],
  events: [["Poster", 3], ["Index", 2], ["Type as image", 2], ["Photographic", 1]],
  weddings: [["Editorial split", 2], ["Type as image", 2], ["Index", 2], ["Photographic", 1]],
  civic: [["Poster", 2], ["Editorial split", 2], ["Index", 2], ["Type as image", 1]],
  general: [["Editorial split", 2], ["Poster", 2], ["Index", 2], ["Photographic", 1], ["Product stage", 1], ["Type as image", 1]],
};
/** A hue family per project for the ground tint and accent, so light sites stop sharing one palette (D1). */
const PALETTE_FAMILIES = ["sage and moss", "sky and slate blue", "terracotta and clay", "butter and ochre", "plum and mauve", "ink navy and brass",
  "coral and blush", "olive and khaki", "teal and sea glass", "rust and sand", "lilac and violet", "charcoal and signal red", "forest and mint", "denim and cream"] as const;
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
  creator: [["Syne", "Space Grotesk"], ["Instrument Serif", "Space Grotesk"], ["Bricolage Grotesque", "DM Sans"], ["Unbounded", "Geist"], ["Fraunces", "Space Grotesk"]],
  commerce: [["Bricolage Grotesque", "Plus Jakarta Sans"], ["Syne", "DM Sans"], ["DM Serif Display", "Outfit"], ["Sora", "Manrope"], ["Playfair Display", "Geist"]],
  wellness: [["Fraunces", "DM Sans"], ["Cormorant", "Manrope"], ["Instrument Serif", "Plus Jakarta Sans"], ["Outfit", "Outfit"], ["DM Serif Display", "Manrope"]],
  trades: [["Archivo", "Archivo"], ["Bebas Neue", "Outfit"], ["Space Grotesk", "Manrope"], ["Sora", "DM Sans"], ["Unbounded", "Geist"]],
  property: [["Instrument Serif", "Geist"], ["Cormorant", "Manrope"], ["Newsreader", "Space Grotesk"], ["Playfair Display", "Plus Jakarta Sans"], ["Syne", "Geist"]],
  events: [["Bebas Neue", "Space Grotesk"], ["Unbounded", "Manrope"], ["Syne", "Geist"], ["Space Grotesk", "JetBrains Mono"], ["Cormorant", "Outfit"]],
  weddings: [["Cormorant", "Manrope"], ["Playfair Display", "Plus Jakarta Sans"], ["Instrument Serif", "Geist"], ["Fraunces", "DM Sans"], ["DM Serif Display", "Outfit"]],
  civic: [["Bricolage Grotesque", "Manrope"], ["Fraunces", "Geist"], ["Sora", "DM Sans"], ["DM Serif Display", "Plus Jakarta Sans"], ["Outfit", "Newsreader"]],
  general: [["Instrument Serif", "Geist"], ["Space Grotesk", "Manrope"], ["Syne", "DM Sans"], ["Newsreader", "Outfit"], ["Bricolage Grotesque", "Geist"]],
};

type Ground = "dark" | "colour flood" | "mid-tone" | "cool light" | "warm light" | "pale tint" | "photographic";
const GROUND_NOTES: Record<Ground, string> = {
  "pale tint": "a pale but clearly tinted ground in the palette family (pale sage, sky, blush, butter, lilac), dark text",
  "dark": "a deep tinted dark ground (not pure black) with light text",
  "colour flood": "one saturated hue from the subject as the ground of the first screen",
  "mid-tone": "a muted mid-value ground (clay, slate, sage, ochre, denim) with dark or light text at AA contrast",
  "cool light": "a cool tinted off-white or pale tint, never pure #fff",
  "warm light": "a warm tinted light ground, but not the default cream: push it toward stone, blush, butter or sand",
  "photographic": "the image is the ground of the first screen",
};
/** Grounds. A blind judge read dark grounds (especially with gold or neon accents) as template-like and
 * preferred calm light pages for services; round 2 still drifted to 7 of 20 dark sites. Light is the
 * default; dark is suggested only where the subject itself is dark (nightlife, events). */
const GROUNDS: Record<Industry, Weighted<Ground>> = {
  food: [["photographic", 2], ["warm light", 2], ["pale tint", 1], ["colour flood", 2], ["dark", 1], ["mid-tone", 1]],
  saas: [["cool light", 3], ["pale tint", 2], ["colour flood", 1], ["mid-tone", 1]],
  professional: [["cool light", 2], ["warm light", 2], ["pale tint", 2], ["mid-tone", 1]],
  creator: [["cool light", 1], ["pale tint", 1], ["colour flood", 2], ["dark", 2], ["warm light", 1], ["mid-tone", 1]],
  commerce: [["pale tint", 2], ["warm light", 1], ["cool light", 1], ["colour flood", 2], ["photographic", 1], ["dark", 1], ["mid-tone", 1]],
  wellness: [["pale tint", 3], ["warm light", 2], ["cool light", 2], ["photographic", 1], ["mid-tone", 1]],
  trades: [["cool light", 2], ["pale tint", 1], ["warm light", 1], ["colour flood", 2], ["dark", 1], ["photographic", 1]],
  property: [["photographic", 2], ["warm light", 2], ["pale tint", 2], ["cool light", 1], ["mid-tone", 1]],
  events: [["dark", 3], ["colour flood", 2], ["photographic", 1], ["pale tint", 1]],
  weddings: [["photographic", 2], ["warm light", 2], ["pale tint", 2], ["cool light", 1]],
  civic: [["warm light", 2], ["pale tint", 2], ["cool light", 1], ["colour flood", 2]],
  general: [["cool light", 2], ["warm light", 1], ["pale tint", 1], ["colour flood", 1], ["dark", 1], ["mid-tone", 1]],
};
/** Industries whose visitors act from a phone on the spot (call, find, check hours, order). */
const QUICK_ACTION_INDUSTRIES: ReadonlySet<Industry> = new Set(["food", "trades", "wellness", "events", "weddings"]);

/** Quiet subjects earn calm, light, typographic restraint; loud ones may be bold. The judge's
 * repeat preferences (a calm editorial law firm, a ledger-paper bookkeeping app, a plain-spoken
 * plumber with a huge phone number) were all quiet executions. */
export type Tone = "quiet" | "loud";
export const TONES: Record<Industry, Tone> = {
  food: "loud", saas: "loud", professional: "quiet", creator: "loud", commerce: "loud", wellness: "quiet",
  trades: "loud", property: "quiet", events: "loud", weddings: "quiet", civic: "loud", general: "loud",
};
const TONE_NOTES: Record<Tone, string> = {
  quiet: "quiet: generous space, a calm palette, refined type at confident sizes and calm motion; quiet is not plain: the first screen carries one ownable, crafted signature drawn for this business (a diagram, illustration or object from its own facts) and every section looks designed for this site",
  loud: "loud: commit to colour and scale: big, characterful display type, a saturated, tinted or deep dark ground where the subject suits it, and one crafted signature graphic carried through the sections; still one dominant device on the first screen and a clear hierarchy",
};
const HEADLINE_DEVICES: Record<Tone, readonly string[]> = {
  quiet: [
    "no accent at all: size, measure and spacing carry the headline",
    "a split headline: a small set-up line, then the claim at full display size",
    "weight contrast within one family, same colour",
  ],
  loud: [
    "weight contrast: one line in a heavy weight against a light one, same colour",
    "scale contrast: one word, numeral or date set far larger than the rest",
    "a solid colour block behind one short phrase (text on it at AA contrast)",
    "a drawn rule or thick underline under one phrase",
    "no accent at all: size, measure and spacing carry the headline",
  ],
};
const SIGNATURE_MOTION: Record<Tone, readonly string[]> = {
  quiet: [
    "staggered rises on lists and figures, nothing else moving",
    "a sticky scroll story: a pinned heading while numbered steps scroll past and the active step is highlighted",
    "a reading-progress rule in the header (data-progress) plus staggered rises",
    "image wipes on one or two figures (data-reveal=\"wipe\") and staggered rises elsewhere",
  ],
  loud: [
    "image wipes: hero-adjacent and section images reveal with data-reveal=\"wipe\" (clip-path) as they enter",
    "scroll-linked depth: one or two large images drift slowly inside clipped frames (data-depth)",
    "a sticky scroll story: a pinned visual or heading while numbered steps scroll past and the active step is highlighted",
    "an index that performs: large linked rows slide in with a stagger and reveal a preview or detail on hover and focus",
    "a slow marquee band of real details (services, dates, places), paused and wrapped under reduced motion",
  ],
};
const COMPOSITIONS: Record<Tone, readonly string[]> = {
  quiet: ["an editorial asymmetric split", "an index list with large numerals", "a numbered process on a timeline", "a printed-card price or menu list",
    "a two-column detail list with hairline rules", "a split call-to-action footer", "a full-width quote or fact set large on the ground colour"],
  loud: ["an editorial asymmetric split with a bleeding image", "layered, overlapping imagery with a caption card", "a sticky scroll story", "an index list with large numerals",
    "a full-bleed band with an overlaid headline", "a printed-card price or menu list", "a bento grid of unequal cells", "a split call-to-action footer"],
};

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

/** Type pairings per answered vibe (display, text): the client's choice of feel sets the type. */
const VIBE_PAIRINGS: Record<NonNullable<DesignAnswers["vibe"]>, readonly Pairing[]> = {
  calm: [["Instrument Serif", "Geist"], ["Cormorant", "Manrope"], ["Newsreader", "Plus Jakarta Sans"], ["Playfair Display", "DM Sans"]],
  bold: [["Unbounded", "Geist"], ["Bricolage Grotesque", "DM Sans"], ["Syne", "Space Grotesk"], ["Bebas Neue", "Outfit"]],
  warm: [["Fraunces", "DM Sans"], ["DM Serif Display", "Manrope"], ["Bricolage Grotesque", "Newsreader"], ["Fraunces", "Outfit"]],
  technical: [["Geist", "JetBrains Mono"], ["Space Grotesk", "Geist"], ["Sora", "Manrope"], ["Plus Jakarta Sans", "JetBrains Mono"]],
};
const VIBE_TONES: Record<NonNullable<DesignAnswers["vibe"]>, Tone> = { calm: "quiet", technical: "quiet", warm: "quiet", bold: "loud" };
const IMAGERY_NOTES: Record<NonNullable<DesignAnswers["imagery"]> | "none", string> = {
  photo: "photographs of this business's specific subject (generate_image kind photo); at most one or two per page, never stock-like",
  illustration: "one illustration technique for the whole site (generate_image kind illustration, or drawn CSS/SVG); no photographs",
  type: "no generated images: typography, colour fields and CSS/SVG shapes carry the page",
  none: "typography, CSS and inline SVG (image generation is unavailable)",
};
const GOAL_NOTES: Record<NonNullable<DesignAnswers["goal"]>, string> = {
  call: "a call (the phone number as one of the two largest elements of the first screen, a tel: link)",
  book: "booking (the booking action in the header, the first screen and the closing section)",
  buy: "buying (products and their prices or a clear way to order, first)",
  visit: "visiting (address, opening hours and directions on the first screen)",
  enquire: "an enquiry (a short, accessible enquiry form reachable from the first screen)",
  signup: "signing up (an email form reachable from the first screen, honest about what happens next)",
};

export type DesignSeed = { industry: Industry; tone: Tone; archetype: Archetype; pairing: Pairing; ground: Ground; palette: string; headline: string; motion: string; compositions: [string, string]; quickActions: boolean };

/**
 * Deterministic for (seed, brief, answers): the client's one-click answers override the per-project
 * draw where they apply (theme sets the ground, vibe the tone and type, imagery the image plan and
 * first-screen archetypes); an enhanced brief's tone applies when the vibe was not answered.
 */
export function designSeed(input: { seed: string; brief: string; images: boolean; design?: DesignAnswers; tone?: Tone }): DesignSeed {
  const industry = detectIndustry(input.brief);
  const design = input.design ?? {};
  const tone = design.vibe ? VIBE_TONES[design.vibe] : input.tone ?? TONES[industry];
  const bytes = digest(input.seed);
  const photos = input.images && design.imagery !== "illustration" && design.imagery !== "type";
  const archetypes = ARCHETYPE_WEIGHTS[industry].filter(([name]) => photos || name !== "Photographic")
    .map(([name, weight]) => [name, design.imagery === "photo" && name === "Photographic" ? weight * 2 : design.imagery === "type" && name === "Type as image" ? weight * 2 : weight] as const);
  const grounds = design.theme === "dark" ? [["dark", 1]] as Weighted<Ground>
    : GROUNDS[industry].filter(([name]) => (photos || name !== "photographic") && (design.theme !== "light" || name !== "dark"));
  const pairings = design.vibe ? VIBE_PAIRINGS[design.vibe] : PAIRINGS[industry];
  const compositions = COMPOSITIONS[tone];
  const first = bytes[5] % compositions.length;
  let second = bytes[6] % compositions.length;
  if (second === first) second = (second + 1) % compositions.length;
  return {
    industry, tone,
    archetype: pick(archetypes, bytes[0]),
    pairing: pairings[bytes[1] % pairings.length],
    ground: pick(grounds, bytes[2]),
    palette: PALETTE_FAMILIES[bytes[7] % PALETTE_FAMILIES.length],
    headline: HEADLINE_DEVICES[tone][bytes[3] % HEADLINE_DEVICES[tone].length],
    motion: SIGNATURE_MOTION[tone][bytes[4] % SIGNATURE_MOTION[tone].length],
    compositions: [compositions[first], compositions[second]],
    quickActions: QUICK_ACTION_INDUSTRIES.has(industry) || design.goal === "call" || design.goal === "visit",
  };
}

/** The user-turn block for a first build. */
export function designSeedBlock(input: { seed: string; brief: string; images: boolean; brand?: boolean; design?: DesignAnswers; tone?: Tone }) {
  const seed = designSeed(input);
  const design = input.design ?? {};
  const [display, text] = seed.pairing;
  const imagery = !input.images ? "none" : design.imagery ?? null;
  return [
    "<design_seed>",
    "Starting points for this project's art direction, chosen per project so Makeborne sites do not converge on one look. Use them unless they clearly conflict with the brief; the brief, an approved plan, a requested style" + (input.brand ? " and the brand kit (its colours and fonts)" : "") + " always win. If you change one, choose something just as specific and say why in finish.design." + (Object.keys(design).length ? " Lines marked (client's answer) come from the client's own one-click answers: follow them." : ""),
    `- Tone: ${TONE_NOTES[seed.tone]}${design.vibe ? " (client's answer)" : ""}.`,
    `- First screen: ${seed.archetype} (${ARCHETYPE_NOTES[seed.archetype]}).`,
    `- Type: "${display}"${display === text ? " for display and text (vary weight, width and size)" : ` for display, "${text}" for text`}${design.vibe ? " (client's answer)" : ""}.`,
    `- Ground: ${seed.ground}: ${GROUND_NOTES[seed.ground]}${design.theme ? " (client's answer)" : ""}. Derive the exact hues from this business.`,
    design.colour ? `- Colour: build the palette around the client's colour ${design.colour} (accent or ground; text on it at AA contrast) (client's answer).`
      : design.logoColours ? "- Colour: take the palette from the client's logo (client's answer)."
      : `- Palette family: lean the ground tint and accent toward ${seed.palette}, adjusted to the subject.`,
    imagery ? `- Imagery: ${IMAGERY_NOTES[imagery]}${design.imagery ? " (client's answer)" : ""}.` : "",
    design.goal ? `- Primary action: ${GOAL_NOTES[design.goal]} (client's answer).` : "",
    `- Headline device: ${seed.headline}.`,
    "- Motif: one quiet visual motif drawn from this business's own working objects (a ledger page, a receipt, a timetable, a map, a menu card, a ticket, a plan drawing), used consistently and drawn with care, never as clip-art.",
    `- Signature motion: ${seed.motion}.`,
    `- Feature these compositions somewhere on the page: ${seed.compositions[0]}; ${seed.compositions[1]}.`,
    seed.quickActions ? "- Mobile quick actions: visitors act from their phone, so add the quick-action bar (only the actions this business has: Call, Directions, Hours, Order or Book) using the quick-action pattern." : "",
    "</design_seed>",
  ].filter(Boolean).join("\n");
}
