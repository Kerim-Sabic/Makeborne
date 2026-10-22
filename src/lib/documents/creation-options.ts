import type { BookImagePlan } from "./schema";

/** Creation options for documents, chosen in the questions before the first build (brief-questions.ts writes the
 * answer into the brief as "- <topic>: <label>") or written in the brief in the client's own words. Deterministic:
 * the same brief always gives the same options. */

export const SLIDE_STYLE_TOPIC = "Slide style";
export const SLIDE_STYLE_OPTIONS = [
  { value: "image", label: "Full-image slides", hint: "Each slide designed as one generated image, text included (default)" },
  { value: "live", label: "Editable text slides", hint: "Text, charts and shapes you can edit in PowerPoint" },
  { value: "auto", label: "You choose" },
] as const;

export const BOOK_IMAGES_TOPIC = "Images in the book";
export const BOOK_IMAGE_OPTIONS = [
  { value: "none", label: "No images" },
  { value: "cover", label: "Cover only" },
  { value: "openers", label: "Cover and chapter openers", hint: "One picture opening each chapter (default)" },
  { value: "every6", label: "Openers plus one every ~6 pages", hint: "Figures where they help the reader" },
  { value: "every3", label: "Openers plus one every ~3 pages" },
  { value: "rich", label: "Richly illustrated", hint: "About one picture per spread" },
] as const;
export const BOOK_IMAGE_STYLE_TOPIC = "Image style";
export const BOOK_IMAGE_STYLE_OPTIONS = [
  { value: "photo", label: "Photography" },
  { value: "illustration", label: "Illustration" },
  { value: "technique", label: "One hand-made technique", hint: "e.g. watercolour, ink or linocut" },
  { value: "auto", label: "You choose" },
] as const;

/** The answer line a topic got in the brief, if any ("- Topic: answer"). */
function answer(brief: string, topic: string) {
  const line = brief.split(/\r?\n/).reverse().find(row => row.trim().toLowerCase().startsWith(`- ${topic.toLowerCase()}:`));
  return line ? line.trim().slice(topic.length + 3).trim() : null;
}

const EDITABLE = /\b(editable (text|slides?|deck|presentation|powerpoint|pptx)|(native(ly)?|fully) editable|editable in (powerpoint|keynote|google slides)|(text|slides?|chart)s?[^.\n]{0,40}\beditable\b|edit (the )?text (myself|later|in powerpoint))/i;
const FULL_IMAGE = /\b(full[- ]image|image[- ]only|fully (generated|designed) (slides|images)|each slide (as )?(an? )?(single |one )?image)\b/i;

/** Slide mode of a new deck: full-image unless the client chose, or explicitly asked for, editable text slides. */
export function deckModeFromBrief(brief: string): { mode: "image" | "live"; reason: string } {
  const chosen = answer(brief, SLIDE_STYLE_TOPIC);
  if (chosen) {
    if (/editable/i.test(chosen)) return { mode: "live", reason: `answer "${chosen.slice(0, 60)}"` };
    if (/full|image/i.test(chosen)) return { mode: "image", reason: `answer "${chosen.slice(0, 60)}"` };
  }
  const editable = EDITABLE.exec(brief);
  if (editable && !FULL_IMAGE.test(brief)) return { mode: "live", reason: `brief asks for "${editable[0]}"` };
  return { mode: "image", reason: "default" };
}

/** Image plan of a new book: the chosen answers, else the client's words, else cover and chapter openers. */
export function bookImagePlanFromBrief(brief: string): BookImagePlan {
  const where = answer(brief, BOOK_IMAGES_TOPIC) ?? "";
  const styleAnswer = answer(brief, BOOK_IMAGE_STYLE_TOPIC) ?? "";
  const text = `${where}\n${brief}`.toLowerCase();
  const every = /\bevery\s*~?\s*(\d{1,2})\s*pages?\b|\bone (?:image|picture|illustration|photo)\s+(?:per|each)\s+(\d{1,2})\s*pages?\b/.exec(where.toLowerCase()) ?? /\b(?:an? |one )?(?:image|picture|illustration|photo|figure)s?\s+(?:about |roughly |~)?every\s+(\d{1,2})\s*pages?\b/.exec(text);
  let placement: BookImagePlan["placement"] = "openers";
  let everyPages: number | undefined;
  const source = where.toLowerCase() || text;
  if (/^no images?\b|\bno (images|pictures|illustrations|photos)\b(?!\s+of\b)|\b(text|type)[- ]only\b|\bwithout (any )?(images|pictures|illustrations)\b/.test(source)) placement = "none";
  else if (/\bcover only\b|\bonly (a |the )?cover( image)?\b|\bjust (a |the )?cover\b/.test(source)) placement = "cover";
  else if (/\brichly illustrated\b|\b(one|an image|a picture) (per|on every|every) spread\b|\bheavily illustrated\b|\bpicture book\b/.test(source)) placement = "rich";
  else if (every) { placement = "every"; everyPages = Math.min(40, Math.max(2, Number(every[1] ?? every[2]))); }
  else if (/\bchapter openers?\b|\bopeners?\b/.test(where.toLowerCase())) placement = "openers";
  // The style comes from its own answer, or from a free-text image answer (an option label such as "Richly illustrated" is not a style).
  const customWhere = BOOK_IMAGE_OPTIONS.some(option => where.toLowerCase().startsWith(option.label.toLowerCase())) ? "" : where;
  const styleText = `${styleAnswer}\n${customWhere}`.toLowerCase();
  const style: BookImagePlan["style"] = /photo/.test(styleText) ? "photo" : /hand-made|handmade|technique|watercolou?r|ink\b|linocut|woodcut|gouache|pencil|charcoal|collage|risograph/.test(styleText) ? "technique"
    : /illustrat|drawn|drawing/.test(styleText) ? "illustration" : "auto";
  const technique = style === "technique" && styleAnswer && !/^one hand-made technique/i.test(styleAnswer) ? styleAnswer.slice(0, 120) : undefined;
  return { placement, ...(everyPages ? { everyPages } : {}), style, ...(technique ? { technique } : {}) };
}
