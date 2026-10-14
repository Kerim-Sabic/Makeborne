import { HELP_ARTICLES, type HelpArticle } from "./articles";

/**
 * Help search without AI: matches a question to articles by title, the words
 * people actually use (keywords) and the answer text, with a few synonyms.
 */
const STOP = new Set("a an and are can do does for from get how i in is it me my of on or the to what when where which who why will with you your".split(" "));
const SYNONYMS: Record<string, string> = {
  site: "website", sites: "website", webpage: "website", homepage: "website", landing: "website", web: "website",
  deck: "presentation", slides: "presentation", slide: "presentation", powerpoint: "presentation", pptx: "presentation", pitch: "presentation",
  ebook: "book", guide: "book", pdf: "book", chapters: "book",
  mail: "email", emails: "email", inbox: "email", gmail: "gmail", outlook: "outlook",
  customers: "clients", customer: "clients", contacts: "clients", client: "clients", crm: "clients",
  prospects: "leads", lead: "leads", prospecting: "leads",
  price: "pricing", prices: "pricing", cost: "credits", costs: "credits", pay: "credits", money: "credits", expensive: "credits",
  domain: "publish", hosting: "publish", live: "publish", launch: "publish", url: "publish",
  approve: "review", approval: "review", feedback: "review", comments: "review",
  advice: "advisor", expert: "advisor", experts: "advisor", chat: "advisor",
  upload: "attach", files: "attach", documents: "attach", photos: "attach",
};

export const tokens = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9+]+/)
  .filter(word => word.length > 1 && !STOP.has(word)).map(word => SYNONYMS[word] ?? word.replace(/(ies)$/, "y").replace(/(?<=[a-z]{3})s$/, ""));

function score(article: HelpArticle, query: string, words: string[]) {
  const lower = query.toLowerCase();
  let total = 0;
  const title = new Set(tokens(article.title)), keys = new Set(article.keywords.flatMap(tokens)), body = new Set(tokens(`${article.answer} ${article.description}`));
  // Exact phrases people use; longer phrases are more specific, so they count for more.
  for (const keyword of article.keywords) if (keyword.length > 3 && lower.includes(keyword)) total += 4 + keyword.split(/\s+/).length * 2;
  for (const word of words) {
    if (title.has(word)) total += 3;
    if (keys.has(word)) total += 3;
    if (body.has(word)) total += 1;
  }
  // A title that covers the whole question beats one that shares a single word with it.
  total += Math.round(5 * words.filter(word => title.has(word)).length / words.length);
  return total;
}

/** Best matches for a question, most relevant first. */
export function searchHelp(query: string, limit = 5) {
  const words = [...new Set(tokens(query))];
  if (!words.length) return [];
  return HELP_ARTICLES.map(article => ({ article, score: score(article, query, words) }))
    .filter(result => result.score >= 3).sort((a, b) => b.score - a.score).slice(0, limit).map(result => result.article);
}
