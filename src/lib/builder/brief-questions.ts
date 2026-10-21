/** Questions asked before the first build of a website, presentation or book.
 * Each question covers one decision that most changes the result (goal,
 * audience, look, scope…) and is asked only when the brief doesn't already
 * answer it. Runs on the device: no model call, no cost. Answers are appended
 * to the brief in plain words so the planner and builder use them. */

export type BriefKind = "website" | "presentation" | "book";
export type BriefOption = { value: string; label: string; hint?: string; swatch?: readonly string[] };
export type BriefQuestion = {
  id: string; question: string; why: string; options: readonly BriefOption[];
  /** Placeholder for the reader's own answer. */
  custom: string;
  /** Wording used when the answer is written into the brief. */
  topic: string;
  /** Shown under the question, e.g. a reminder to attach a logo. */
  note?: string;
  /** Several options may be chosen (chips toggle; no auto-advance). */
  multi?: boolean;
  /** Offers a colour picker next to the options. */
  color?: boolean;
};
export type BriefAnswer = { option?: string; options?: readonly string[]; custom?: string; color?: string };
export type BriefAnswers = Record<string, BriefAnswer>;

/** The design decisions a website answer sets, in a fixed vocabulary the design seed and the brief
 * enhancer read deterministically (dark/light sets the ground, vibe the tone and type, imagery the
 * image plan and routing). Only chosen answers appear: a skipped question leaves its field out. */
export type DesignAnswers = {
  theme?: "light" | "dark";
  vibe?: "calm" | "bold" | "warm" | "technical";
  imagery?: "photo" | "illustration" | "type";
  goal?: "call" | "book" | "buy" | "visit" | "enquire" | "signup";
  sections?: ("prices" | "hours" | "gallery" | "team" | "testimonials" | "faq" | "contact")[];
  colour?: string;
  logoColours?: boolean;
};
export const DESIGN_SECTION_LABELS: Record<NonNullable<DesignAnswers["sections"]>[number], string> = {
  prices: "Prices or menu", hours: "Opening hours", gallery: "Gallery", team: "Team", testimonials: "Testimonials", faq: "FAQ", contact: "Contact form",
};

const STYLE: BriefQuestion = {
  id: "style", topic: "Look and feel", custom: "Describe it, e.g. like a Japanese tea house",
  question: "What should it feel like?",
  why: "The look is the biggest single decision. Pick one and we'll design everything around it.",
  options: [
    { value: "warm", label: "Warm and crafted", hint: "Earthy colours, texture, characterful type", swatch: ["#7a3b22", "#e9dcc6", "#2f3a2c"] },
    { value: "bold", label: "Bold and modern", hint: "Big type, strong contrast, confident colour", swatch: ["#111111", "#ff5a1f", "#f4f1ea"] },
    { value: "calm", label: "Calm and premium", hint: "Generous space, refined type, quiet palette", swatch: ["#1f2a2e", "#c8b99a", "#f6f4ef"] },
    { value: "playful", label: "Playful and colourful", hint: "Bright colour, friendly shapes, energy", swatch: ["#ffcf3f", "#3b5bff", "#ff6fa8"] },
    { value: "dark", label: "Dark and dramatic", hint: "Deep backgrounds, luminous accents", swatch: ["#0d0f12", "#c9a24a", "#e8e3d8"] },
    { value: "minimal", label: "Clean and minimal", hint: "White space, one accent, precise grid", swatch: ["#ffffff", "#111111", "#2f6bff"] },
  ],
};

/** Words that show the brief already sets a look. */
const STYLE_ANSWERED = /\b(look|feel|vibe|style|aesthetic|palette|colou?rs?|modern|minimal\w*|bold|playful|luxur\w*|premium|elegant|warm|dark|clean|retro|vintage|brutal\w*|editorial|calm|rustic|futuris\w*|corporate|organic|handmade|neon|pastel|monochrome|classic|brand(ed|ing)?)\b|#[0-9a-f]{3,6}\b/;

/** Website look and feel: four vibes with swatches (sets the tone and type pairing). */
const VIBE: BriefQuestion = {
  id: "vibe", topic: "Look and feel", custom: "Describe it, e.g. like a Japanese tea house",
  question: "What should it feel like?",
  why: "The look is the biggest single decision. Pick one and we'll design everything around it.",
  options: [
    { value: "calm", label: "Calm and premium", hint: "Generous space, refined type, quiet palette", swatch: ["#1f2a2e", "#c8b99a", "#f6f4ef"] },
    { value: "bold", label: "Bold and playful", hint: "Big type, confident colour, energy", swatch: ["#ffcf3f", "#3b5bff", "#ff5a1f"] },
    { value: "warm", label: "Warm and crafted", hint: "Earthy colours, texture, characterful type", swatch: ["#7a3b22", "#e9dcc6", "#2f3a2c"] },
    { value: "technical", label: "Clean and technical", hint: "Precise grid, one accent, crisp type", swatch: ["#ffffff", "#111111", "#2f6bff"] },
  ],
};
/** Words that set the website's vibe (light or dark alone is the theme question, not the vibe). */
const VIBE_ANSWERED = /\b(look|feel|vibe|style|aesthetic|modern|minimal\w*|bold|playful|luxur\w*|premium|elegant|warm|clean|retro|vintage|brutal\w*|editorial|calm|rustic|futuris\w*|corporate|organic|handmade|neon|pastel|monochrome|classic|technical|crafted|friendly|serious|fun)\b/;
/** Kinds of business whose visitors need prices, hours or a quick call: sections and quick actions matter most. */
const LOCAL = /\b(restaurant|caf[eé]|coffee|bakery|bakehouse|bistro|bar|pub|deli|pizza|dentist|dental|clinic|doctor|physio\w*|vet|salon|barber|spa|gym|yoga|pilates|studio|plumb\w*|electric\w*|roof\w*|garage|mechanic|builder|cleaner|cleaning|locksmith|florist|shop|store|hotel|b&b|guesthouse|venue|nursery|school|tutor\w*|therap\w*|massage)\b/;

const BANK: Record<BriefKind, { question: BriefQuestion; answered: RegExp; rank?: (text: string) => number }[]> = {
  website: [
    { answered: VIBE_ANSWERED, rank: () => 10, question: VIBE },
    { answered: /\b(book(ing)?s?|reserv\w*|order\w*|buy\w*|shop online|sell\w*|call\w*|phone|contact\w*|enquir\w*|inquir\w*|quote\w*|sign[- ]?up|subscri\w*|join\w*|wait[- ]?list|download\w*|donat\w*|appointment\w*|register\w*|apply|hire|visit us|drop in|walk[- ]in)\b/,
      rank: () => 9,
      question: { id: "goal", topic: "Main thing visitors should do", custom: "e.g. Ask for a free site visit",
        question: "What should visitors do first?", why: "Every page is built to lead to this one action.",
        options: [
          { value: "call", label: "Call" }, { value: "book", label: "Book" }, { value: "buy", label: "Buy" },
          { value: "visit", label: "Visit" }, { value: "enquire", label: "Send an enquiry" }, { value: "signup", label: "Sign up" },
        ] } },
    { answered: /\b(sections?|menu|prices?|pricing|price list|opening hours|hours|gallery|team|testimonials?|reviews|faqs?|contact form)\b[\s\S]*\b(sections?|menu|prices?|pricing|opening hours|hours|gallery|team|testimonials?|reviews|faqs?|contact form)\b[\s\S]*\b(sections?|menu|prices?|pricing|opening hours|hours|gallery|team|testimonials?|reviews|faqs?|contact form)\b/,
      rank: text => LOCAL.test(text) ? 8 : 5,
      question: { id: "sections", topic: "Must-have sections", custom: "e.g. A page for each treatment", multi: true,
        question: "Which sections must it have?", why: "Choose all that apply. Each one gets a real section, with clear placeholders for facts you haven't given yet.",
        options: (Object.entries(DESIGN_SECTION_LABELS) as [string, string][]).map(([value, label]) => ({ value, label })) } },
    { answered: /\b(photo\w*|pictures?|images?|imagery|illustrat\w*|drawings?|artwork|typograph\w*|type[- ]only|no images)\b/,
      rank: text => LOCAL.test(text) ? 7 : 6,
      question: { id: "imagery", topic: "Imagery", custom: "e.g. Hand-drawn maps of our routes",
        question: "Photos, illustration or mostly type?", why: "Sets the image plan: real-looking photographs, one illustration style, or bold typography.",
        options: [
          { value: "photo", label: "Photos", hint: "Photographs of the specific subject; your own can replace them later" },
          { value: "illustration", label: "Illustration", hint: "One drawn style across the whole site" },
          { value: "type", label: "Mostly type", hint: "Typography, colour and simple shapes" },
          { value: "auto", label: "You choose" },
        ] } },
    { answered: /\b(dark|light|night|black background|white background|pale|bright)\b/,
      rank: text => /\b(bar|club|night\w*|venue|gig|festival|cocktail|tattoo|gaming|cinema)\b/.test(text) ? 8 : 6,
      question: { id: "theme", topic: "Light or dark", custom: "e.g. Dark like a jazz bar",
        question: "Light or dark?", why: "Sets the ground every page is built on.",
        options: [
          { value: "light", label: "Light", hint: "A light ground with dark text", swatch: ["#f7f5f0", "#1b1d1f", "#2f6bff"] },
          { value: "dark", label: "Dark", hint: "A deep ground with light text", swatch: ["#111418", "#e9e6df", "#d4a24a"] },
          { value: "auto", label: "Let Makeborne choose" },
        ] } },
    { answered: /\b(logo|brand(ing)? (colou?rs?|guide\w*|kit|book)|our colou?rs?|colou?r palette|fonts? we use)\b|#[0-9a-f]{3,6}\b/,
      rank: () => 5,
      question: { id: "colour", topic: "Brand colour", custom: "e.g. Navy and gold", color: true,
        question: "Any colours to use?", why: "We'll build the palette around your colour instead of inventing one.",
        note: "To use your logo, attach it with the paperclip before you start.",
        options: [
          { value: "logo", label: "Use my logo's colours" }, { value: "auto", label: "Choose for me" },
        ] } },
    { answered: /\b(for (local|small|busy|young|new|famil\w+|parents|students|professionals|business\w*|compan\w+|clients|customers|investors|developers|teams|people|women|men|kids|pet \w+|dog \w+|homeowners|tourists|patients)|audience|customers|clients|b2b|b2c|locals|tourists|patients|members|homeowners)\b/,
      question: { id: "audience", topic: "Main audience", custom: "e.g. Busy parents within 5 km",
        question: "Who is it mainly for?", why: "Words, images and layout change a lot between audiences.",
        options: [
          { value: "local", label: "Local customers nearby" }, { value: "online", label: "Customers anywhere online" },
          { value: "business", label: "Other businesses" }, { value: "premium", label: "High-end clients" },
          { value: "investors", label: "Investors or partners" },
        ] }, rank: () => 4 },
    { answered: /\b(one[- ]page|single[- ]page|landing|pages?|blog|multi[- ]page)\b/, rank: () => 3,
      question: { id: "scope", topic: "Size of the site", custom: "List the pages you need",
        question: "How big should the site be?", why: "So we plan the right pages from the start.",
        options: [
          { value: "one", label: "One strong page", hint: "Everything on a single scrolling page" },
          { value: "few", label: "A few pages", hint: "Home, about, services, contact" },
          { value: "full", label: "A full site", hint: "Several sections plus news or a blog" },
        ] } },
  ],
  presentation: [
    { answered: /\b(pitch\w*|investor\w*|fundrais\w*|seed|series [ab]|proposal\w*|sales|webinar|talk|keynote|conference|training|workshop|onboarding|report\w*|update|quarterly|board|strategy|launch\w*|lesson|lecture|class|course)\b/,
      question: { id: "purpose", topic: "Purpose of the deck", custom: "e.g. Win a city council grant",
        question: "What is this presentation for?", why: "The story structure is different for each one.",
        options: [
          { value: "pitch", label: "Investor pitch" }, { value: "proposal", label: "Client proposal or sales" },
          { value: "talk", label: "Talk or keynote" }, { value: "report", label: "Report or update" },
          { value: "training", label: "Training or workshop" }, { value: "launch", label: "Product launch" },
        ] } },
    { answered: /\b(present(ed|ing)? (it )?live|on stage|speak\w*|read (it )?on their own|send (it )?(to|by)|email\w*|leave[- ]behind|self[- ]explanatory|async)\b/,
      question: { id: "delivery", topic: "How it will be used", custom: "e.g. Shown on a screen in a pitch meeting",
        question: "Will you present it, or will people read it on their own?", why: "Presented decks need few words and big visuals; read decks need more on each slide.",
        options: [
          { value: "live", label: "I'll present it live", hint: "Few words, big visuals" },
          { value: "read", label: "People will read it", hint: "Clear detail on each slide" },
          { value: "both", label: "Both" },
        ] } },
    { answered: STYLE_ANSWERED, question: { ...STYLE, why: "Pick a direction and every slide is designed around it, not a template." } },
    { answered: /\b\d{1,2}[\s-]*(slides?|pages?|minutes?|mins?)\b|\b(short|quick|brief|long|detailed)\b/,
      question: { id: "length", topic: "Length", custom: "e.g. 7 slides for a 5-minute slot",
        question: "How long should it be?", why: "So each slide gets room to make one clear point.",
        options: [
          { value: "short", label: "Short", hint: "About 6–8 slides" }, { value: "standard", label: "Standard", hint: "About 10–12 slides" },
          { value: "long", label: "Detailed", hint: "15–20 slides" },
        ] } },
  ],
  book: [
    { answered: /\b(guide\w*|how[- ]to|handbook|playbook|workbook|memoir|stor(y|ies)|novel|biograph\w*|report|white ?paper|e-?book|lead magnet|course|manual|cookbook|recipes?)\b/,
      question: { id: "type", topic: "Kind of book", custom: "e.g. A field guide to urban birds",
        question: "What kind of book is it?", why: "A practical guide, a story and a report are written and designed very differently.",
        options: [
          { value: "guide", label: "Practical guide or how-to" }, { value: "magnet", label: "Free guide to win customers" },
          { value: "story", label: "Story or memoir" }, { value: "report", label: "Report or white paper" },
          { value: "workbook", label: "Workbook with exercises" },
        ] } },
    { answered: /\b(for (beginners|professionals|experts|founders|freelancers|parents|students|teens|kids|children|clients|customers|managers|leaders|readers|owners)|beginners?|advanced|audience|readers)\b/,
      question: { id: "reader", topic: "Reader", custom: "e.g. First-time home buyers in the UK",
        question: "Who is the reader?", why: "Sets the depth, the examples and the vocabulary.",
        options: [
          { value: "beginner", label: "Beginners" }, { value: "pro", label: "Professionals" },
          { value: "customers", label: "My customers" }, { value: "general", label: "General readers" },
        ] } },
    { answered: /\b(tone|voice|friendly|practical|formal|casual|funny|humou?r\w*|serious|inspir\w*|academic|conversational|authoritative|playful)\b/,
      question: { id: "tone", topic: "Tone of voice", custom: "e.g. Like a patient mentor",
        question: "How should it sound?", why: "Tone carries through every chapter.",
        options: [
          { value: "friendly", label: "Friendly and practical" }, { value: "expert", label: "Expert and authoritative" },
          { value: "warm", label: "Warm and personal" }, { value: "bold", label: "Bold and provocative" },
        ] } },
    { answered: /\b\d+[\s-]*(pages?|chapters?|words)\b|\b(short|long|quick read|in[- ]depth)\b/,
      question: { id: "length", topic: "Length", custom: "e.g. 5 chapters",
        question: "How long should it be?", why: "So the chapters are planned to the right depth.",
        options: [
          { value: "short", label: "Short read", hint: "3–5 short chapters" }, { value: "medium", label: "Medium", hint: "6–10 chapters" },
          { value: "long", label: "In depth", hint: "10+ chapters" },
        ] } },
  ],
};

/** Ids of the standard questions this brief already answers (a tailored question with one of these ids is not asked again). */
/** Brand or colour questions an attached file (logo, brand guide) already answers. */
const ATTACHMENT_ANSWERS = new Set(["brand", "colour"]);
const normalise = (brief: string) => brief.toLowerCase().replace(/\s+/g, " ");

export function answeredQuestionIds(kind: BriefKind, brief: string, context: { attachments?: number } = {}): Set<string> {
  const text = normalise(brief);
  const ids = new Set(BANK[kind].filter(item => item.answered.test(text) || (ATTACHMENT_ANSWERS.has(item.question.id) && (context.attachments ?? 0) > 0)).map(item => item.question.id));
  // An AI-tailored "style" question is the website vibe question.
  if (kind === "website" && ids.has("vibe")) ids.add("style");
  // ...and a tailored "brand" question is the colour question (a logo or colours already given).
  if (kind === "website" && ids.has("colour")) ids.add("brand");
  return ids;
}

/** How many questions a brief of this length gets: short, vague briefs benefit most. */
export function questionLimit(kind: BriefKind, brief: string) {
  const words = normalise(brief).trim() ? normalise(brief).trim().split(" ").length : 0;
  if (kind !== "website") return words > 150 ? 2 : words > 60 ? 3 : 4;
  // A detailed website brief (over 150 words) goes straight to building; the free analysis reads its own words instead.
  return words > 150 ? 0 : words > 60 ? 2 : words > 20 ? 4 : 5;
}

/** Questions the brief leaves open, the ones that most change the design for this brief first. A detailed brief gets fewer. */
export function briefQuestions(kind: BriefKind, brief: string, context: { attachments?: number } = {}): BriefQuestion[] {
  const text = normalise(brief);
  const answered = answeredQuestionIds(kind, brief, context);
  const open = BANK[kind].map((item, index) => ({ item, index, rank: item.rank?.(text) ?? -index }))
    .filter(({ item }) => !answered.has(item.question.id))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map(({ item }) => item.question);
  return open.slice(0, questionLimit(kind, brief));
}

/** A standard question by id (a tailored "style" question on a website is the vibe question). */
export function standardQuestion(kind: BriefKind, id: string): BriefQuestion | undefined {
  const wanted = kind === "website" && id === "style" ? "vibe" : id;
  return BANK[kind].find(item => item.question.id === wanted)?.question;
}

/** Tailored questions that ask about a design decision the standard questions already cover. */
const DESIGN_TOPIC = /\b(look|feel|vibe|style|colou?rs?|palette|font|dark|light|photo\w*|imag\w*|illustrat\w*|logo|brand)\b/i;
/**
 * The questions shown before a first website build: the standard design questions for this brief
 * (ranked by how much each changes the design) with the AI-tailored, business-specific ones
 * interleaved after the top three, never more than the brief's limit (5 for a short website brief).
 * Other kinds keep the tailored set when there is one.
 */
export function mergedQuestions(kind: BriefKind, brief: string, tailored: readonly BriefQuestion[] | null, context: { attachments?: number } = {}): BriefQuestion[] {
  const standard = briefQuestions(kind, brief, context);
  if (kind !== "website") return tailored ? [...tailored] : standard;
  const ids = new Set(standard.map(question => question.id));
  const specific = (tailored ?? []).filter(question => !ids.has(question.id) && !standardQuestion(kind, question.id) && !DESIGN_TOPIC.test(`${question.question} ${question.topic}`)).slice(0, 2);
  return [...standard.slice(0, 3), ...specific, ...standard.slice(3)].slice(0, questionLimit(kind, brief));
}

const shortText = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
/** Runtime check for questions that arrive over the network. */
export function isBriefQuestion(value: unknown): value is BriefQuestion {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return shortText(item.id, 32) && shortText(item.question, 140) && shortText(item.why, 160) && shortText(item.topic, 60) && shortText(item.custom, 80)
    && (item.multi === undefined || typeof item.multi === "boolean") && (item.color === undefined || typeof item.color === "boolean")
    && Array.isArray(item.options) && item.options.length <= (item.multi ? 8 : 6) && item.options.every(option => {
      const record = option as Record<string, unknown>;
      return !!option && typeof option === "object" && shortText(record.value, 20) && shortText(record.label, 60)
        && (record.hint === undefined || shortText(record.hint, 80))
        && (record.swatch === undefined || (Array.isArray(record.swatch) && record.swatch.length <= 4 && record.swatch.every(color => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color))));
    });
}

/** The brief plus the chosen answers, in plain words. Unanswered questions are left to the builder. */
export function briefWithAnswers(brief: string, questions: readonly BriefQuestion[], answers: BriefAnswers): string {
  const lines = questions.flatMap(question => {
    const answer = answers[question.id];
    const custom = answer?.custom?.trim().replace(/\s+/g, " ").slice(0, 300);
    if (custom) return [`- ${question.topic}: ${custom}`];
    const color = question.color && answer?.color && HEX.test(answer.color) ? answer.color.toLowerCase() : null;
    if (color) return [`- ${question.topic}: ${color}`];
    if (question.multi) {
      const chosen = question.options.filter(item => answer?.options?.includes(item.value));
      return chosen.length ? [`- ${question.topic}: ${chosen.map(item => item.label).join(", ")}`] : [];
    }
    const option = question.options.find(item => item.value === answer?.option);
    return option ? [`- ${question.topic}: ${option.label}${option.hint ? ` (${option.hint})` : ""}`] : [];
  });
  return lines.length ? `${brief.trim()}\n\nThe client's answers to Makeborne's questions (follow them):\n${lines.join("\n")}` : brief.trim();
}

const HEX = /^#[0-9a-f]{6}$/i;
const pickOne = <T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined => allowed.find(item => item === value);
/**
 * The design decisions in the chosen answers (website questions only). Deterministic: the same answers
 * always give the same fields; "Let Makeborne choose", "You choose", a free-text answer and a skipped
 * question all leave the field out (the free text still reaches the brief in the client's words).
 */
export function designAnswers(questions: readonly BriefQuestion[], answers: BriefAnswers): DesignAnswers {
  const asked = new Set(questions.map(question => question.id));
  const answer = (id: string) => asked.has(id) && !answers[id]?.custom?.trim() ? answers[id] : undefined;
  const out: DesignAnswers = {};
  const theme = pickOne(answer("theme")?.option, ["light", "dark"] as const); if (theme) out.theme = theme;
  const vibe = pickOne(answer("vibe")?.option, ["calm", "bold", "warm", "technical"] as const); if (vibe) out.vibe = vibe;
  const imagery = pickOne(answer("imagery")?.option, ["photo", "illustration", "type"] as const); if (imagery) out.imagery = imagery;
  const goal = pickOne(answer("goal")?.option, ["call", "book", "buy", "visit", "enquire", "signup"] as const); if (goal) out.goal = goal;
  const sections = (answer("sections")?.options ?? []).filter((value): value is NonNullable<DesignAnswers["sections"]>[number] => value in DESIGN_SECTION_LABELS);
  if (sections.length) out.sections = [...new Set(sections)];
  const colour = answer("colour");
  if (colour?.color && HEX.test(colour.color)) out.colour = colour.color.toLowerCase();
  else if (colour?.option === "logo") out.logoColours = true;
  return out;
}

/** Plain words for the answers a build used (shown with the enhanced brief and the receipt). */
export function designAnswerLabels(design: DesignAnswers): string[] {
  const vibes = { calm: "Calm and premium", bold: "Bold and playful", warm: "Warm and crafted", technical: "Clean and technical" } as const;
  const imagery = { photo: "Photos", illustration: "Illustration", type: "Mostly type" } as const;
  const goals = { call: "Call", book: "Book", buy: "Buy", visit: "Visit", enquire: "Send an enquiry", signup: "Sign up" } as const;
  return [
    design.theme && `Theme: ${design.theme === "dark" ? "Dark" : "Light"}`,
    design.vibe && `Feel: ${vibes[design.vibe]}`,
    design.imagery && `Imagery: ${imagery[design.imagery]}`,
    design.goal && `Main action: ${goals[design.goal]}`,
    design.sections?.length && `Sections: ${design.sections.map(id => DESIGN_SECTION_LABELS[id]).join(", ")}`,
    design.colour && `Colour: ${design.colour}`,
    design.logoColours && "Colours: from your logo",
  ].filter((line): line is string => Boolean(line));
}
