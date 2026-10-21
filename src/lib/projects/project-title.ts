/**
 * Project titles. A title the user (or a previous build) saved is kept as it
 * is. A project created without one gets a short fallback derived from its
 * saved brief: deterministic (the same brief always gives the same title, so
 * the builder can recognise it later), editable like any other title, and
 * stripped of contact details and links. Attachment and source text are never
 * read. Historical projects are not renamed. Client-safe; no dependencies.
 */
export type TitleKind = "website" | "book" | "presentation";
export const FALLBACK_TITLE_MAX = 60;

/** The generic name used before a real title existed. Never saved by new creations. */
export const placeholderTitle = (kind: TitleKind) => `Untitled ${kind}`;
export const isPlaceholderTitle = (title: string) => /^untitled(?: (?:website|book|presentation|project))?$/i.test(title.trim());

// Lines Makeborne itself appends after the user's brief when it saves a project.
const COMPOSED = /^(?:APPROVED PROJECT PLAN\b|Requirements:)/;
const URL_LIKE = /(?:https?:\/\/|www\.)\S+|\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[a-z]{2,24}\b(?:\/\S*)?/giu;
const EMAIL = /[^\s@<>()[\],;:]+@[^\s@<>()[\],;:]+/gu;
const HANDLE = /(?<!\S)@[\p{L}\p{N}_.]+/gu;
const PHONE_LIKE = /\+?\d[\d\s()./-]{5,}\d/g;
const LONG_NUMBER = /\d{5,}/g;
const YEAR_RANGE = /^(?:19|20)\d{2}\s*[-–/]\s*(?:19|20)?\d{2}$/;
const LEAD_IN = /^(?:(?:hi|hello|hey|please)\b[,!]?\s*)*(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:(?:help me|help us|i want|i need|i would like|i'd like|we want|we need|we would like|we'd like|let's|lets)\s+(?:to\s+)?)?(?:(?:plan|create|build|make|design|write|draft|prepare|turn|shape|structure|start|put together)\b\s*)?/i;
const ARTICLE = /^(?:a|an|the|my|our)\s+/i;
const TRAILING = /(?:\s+(?:for|to|with|and|or|of|the|a|an|in|at|on|by|from|via|call|email|contact|phone|see|visit|including)|[\s,.&+'’#-])+$/;

/** Links, email addresses, handles, phone numbers (7+ digits) and long numbers in the text. */
function sensitiveSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const pattern of [URL_LIKE, EMAIL, HANDLE, PHONE_LIKE, LONG_NUMBER])
    for (const match of text.matchAll(pattern))
      if (pattern !== PHONE_LIKE || (match[0].match(/\d/g) ?? []).length >= 7 && !YEAR_RANGE.test(match[0].trim())) spans.push([match.index, match.index + match[0].length]);
  return spans.sort((a, b) => a[0] - b[0]);
}

/** Text before the first contact detail or link when that still names something (two words); otherwise the text with all of them removed. */
function withoutSensitive(text: string) {
  const spans = sensitiveSpans(text);
  if (!spans.length) return text;
  const before = text.slice(0, spans[0][0]);
  if ((before.match(/\p{L}+/gu) ?? []).length >= 2) return before;
  let rest = "", at = 0;
  for (const [start, end] of spans) { if (start >= at) rest += text.slice(at, start) + " "; at = Math.max(at, end); }
  return rest + text.slice(at);
}

/** The first line of the brief's first paragraph, extended until it is long enough to name something, without contact details. */
function leadingText(brief: string) {
  const paragraph = brief.trim().split(/\n\s*\n/)[0] ?? "";
  const line = paragraph.split("\n").map(item => item.trim()).find(Boolean) ?? "";
  if (COMPOSED.test(line)) return "";
  let text = "";
  for (const sentence of line.split(/(?<=[.!?])\s+/)) { text = text ? `${text} ${sentence}` : sentence; if (text.length >= 12) break; }
  // Contact details and links go first (a URL's colon is not a clause break), then the first clause only.
  text = withoutSensitive(text);
  const clause = text.split(/\s[—–-]\s|[;:()[\]{}|]/)[0];
  return /\p{L}[\s\S]*\p{L}/u.test(clause) ? clause : text;
}

/** A short, deterministic and non-sensitive title from a saved brief, or the placeholder when nothing usable remains. */
export function fallbackProjectTitle(brief: string, kind: TitleKind): string {
  let text = leadingText(brief.normalize("NFC")).trimStart();
  const lead = text.match(LEAD_IN)?.[0] ?? "";
  text = text.slice(lead.length);
  if (lead.trim()) text = text.replace(ARTICLE, "");
  text = text.replace(/[^\p{L}\p{M}\p{N}\s&'’.,+#-]/gu, " ").replace(/\s+/g, " ").replace(/\s+([,.])/g, (_, mark: string) => mark).trim().replace(TRAILING, "");
  if (text.length > FALLBACK_TITLE_MAX) {
    const cut = text.slice(0, FALLBACK_TITLE_MAX + 1);
    const space = cut.lastIndexOf(" ");
    text = (space >= 20 ? cut.slice(0, space) : cut.slice(0, FALLBACK_TITLE_MAX)).replace(TRAILING, "");
  }
  if ((text.match(/\p{L}/gu) ?? []).length < 2) return placeholderTitle(kind);
  return text.charAt(0).toLocaleUpperCase("en") + text.slice(1);
}

/** The title to save when creating: the user's own, else the brief-derived fallback. */
export function creationTitle(explicit: string, brief: string, kind: TitleKind): string {
  const own = explicit.trim();
  return own && !isPlaceholderTitle(own) ? own : fallbackProjectTitle(brief, kind);
}

/**
 * The title a build saves. A builder's proposed name (for a website, the brand
 * name it used as the site title) may replace only a placeholder or the
 * fallback Makeborne derived from this project's brief; a title the user or a
 * previous build chose is kept.
 */
export function builtTitle(current: string, proposed: string | undefined, brief: string, kind: TitleKind): string {
  const next = proposed?.trim();
  if (!next) return current;
  return isPlaceholderTitle(current) || current === fallbackProjectTitle(brief, kind) ? next : current;
}
