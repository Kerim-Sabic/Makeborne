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
};
export type BriefAnswer = { option?: string; custom?: string };
export type BriefAnswers = Record<string, BriefAnswer>;

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

const BANK: Record<BriefKind, { question: BriefQuestion; answered: RegExp }[]> = {
  website: [
    { answered: /\b(book(ing)?s?|reserv\w*|order\w*|buy\w*|shop\w*|sell\w*|store|call\w*|phone|contact\w*|enquir\w*|inquir\w*|quote\w*|sign[- ]?up|subscri\w*|join\w*|wait[- ]?list|download\w*|donat\w*|appointment\w*|register\w*|apply|hire|portfolio)\b/,
      question: { id: "goal", topic: "Main thing visitors should do", custom: "e.g. Ask for a free site visit",
        question: "What should visitors do first?", why: "Every page is built to lead to this one action.",
        options: [
          { value: "book", label: "Book or reserve" }, { value: "contact", label: "Call or send a message" },
          { value: "buy", label: "Buy or order online" }, { value: "quote", label: "Request a quote" },
          { value: "visit", label: "Visit in person" }, { value: "signup", label: "Sign up or join a waitlist" },
        ] } },
    { answered: STYLE_ANSWERED, question: STYLE },
    { answered: /\b(for (local|small|busy|young|new|famil\w+|parents|students|professionals|business\w*|compan\w+|clients|customers|investors|developers|teams|people|women|men|kids|pet \w+|dog \w+|homeowners|tourists|patients)|audience|customers|clients|b2b|b2c|locals|tourists|patients|members|homeowners)\b/,
      question: { id: "audience", topic: "Main audience", custom: "e.g. Busy parents within 5 km",
        question: "Who is it mainly for?", why: "Words, images and layout change a lot between audiences.",
        options: [
          { value: "local", label: "Local customers nearby" }, { value: "online", label: "Customers anywhere online" },
          { value: "business", label: "Other businesses" }, { value: "premium", label: "High-end clients" },
          { value: "investors", label: "Investors or partners" },
        ] } },
    { answered: /\b(one[- ]page|single[- ]page|landing|pages?|blog|sections?|multi[- ]page)\b/,
      question: { id: "scope", topic: "Size of the site", custom: "List the pages you need",
        question: "How big should the site be?", why: "So we plan the right pages from the start.",
        options: [
          { value: "one", label: "One strong page", hint: "Everything on a single scrolling page" },
          { value: "few", label: "A few pages", hint: "Home, about, services, contact" },
          { value: "full", label: "A full site", hint: "Several sections plus news or a blog" },
        ] } },
    { answered: /\b(logo|brand(ing)? (colou?rs?|guide\w*|kit|book)|our colou?rs?|fonts? we use)\b|#[0-9a-f]{3,6}\b/,
      question: { id: "brand", topic: "Brand assets", custom: "e.g. Navy and gold, our logo is a fox",
        question: "Do you already have a logo or brand colours?", why: "We'll match them exactly instead of inventing a new identity.",
        note: "To use your logo or brand guide, attach it with the paperclip before you start.",
        options: [
          { value: "attached", label: "Yes, I've attached them" }, { value: "describe", label: "Yes, I'll describe them" },
          { value: "new", label: "No, create an identity for me" },
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

/** Questions the brief leaves open, most important first. A detailed brief gets fewer. */
export function briefQuestions(kind: BriefKind, brief: string, context: { attachments?: number } = {}): BriefQuestion[] {
  const text = brief.toLowerCase().replace(/\s+/g, " ");
  const words = text.trim() ? text.trim().split(" ").length : 0;
  const open = BANK[kind]
    .filter(item => !item.answered.test(text))
    .filter(item => !(item.question.id === "brand" && (context.attachments ?? 0) > 0))
    .map(item => item.question);
  const limit = words > 150 ? 2 : words > 60 ? 3 : 4;
  return open.slice(0, limit);
}

const shortText = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
/** Runtime check for questions that arrive over the network. */
export function isBriefQuestion(value: unknown): value is BriefQuestion {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return shortText(item.id, 32) && shortText(item.question, 140) && shortText(item.why, 160) && shortText(item.topic, 60) && shortText(item.custom, 80)
    && Array.isArray(item.options) && item.options.length <= 6 && item.options.every(option => {
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
    const option = question.options.find(item => item.value === answer?.option);
    return option ? [`- ${question.topic}: ${option.label}${option.hint ? ` (${option.hint})` : ""}`] : [];
  });
  return lines.length ? `${brief.trim()}\n\nThe client's answers to Makeborne's questions (follow them):\n${lines.join("\n")}` : brief.trim();
}
