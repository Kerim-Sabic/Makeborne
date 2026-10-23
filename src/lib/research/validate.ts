import {
  ModelBriefSchema, RESEARCH_VERSION, SECTIONS, type ModelClaim, type ParsedModelBrief, type ResearchBrief, type Section, type StoredCitation, type StoredClaim,
} from "./contract";
import { sourceViews, type Material, type MaterialSource } from "./material";
import { SEARCH_REFUSED_REASON } from "./search";

/**
 * Server-side grounding of a brief, whoever wrote it (a model or the
 * deterministic reader). Schema-valid is not enough:
 * - a citation counts only if its source exists in this request, is not kept
 *   apart by the identity check, and contains the quote word for word;
 * - a "fact" with no citation that counts is downgraded to an inference (and
 *   says so); one that cited only kept-apart sources is removed;
 * - revenue, follower/subscriber counts and demographics survive only as a
 *   fact whose own quote states the same figure and term; claims of access
 *   to private profiles, messages or analytics are always removed;
 * - competitors must be competitor pages that were actually read;
 * - recommendations must name a supported deliverable and a business reason
 *   that passes the same guard.
 * Everything removed is listed with its reason, so nothing disappears silently.
 */
export const GUARDS = [
  { id: "private", always: true, reason: "Claims about private profiles, messages or analytics are never included.",
    pattern: /\b(private (account|profile|page|group|instagram|facebook|feed)|direct messages?|dms?|logged[- ]in view|behind (a|the|their) (login|sign-?in)|their inbox|internal (dashboard|analytics|data|numbers)|analytics (data|dashboard)|insights (data|tab))\b/i },
  { id: "revenue", always: false, reason: "Revenue and other financial figures are never estimated; only a source that states them can be cited.",
    pattern: /\b(revenues?|turnover|annual sales|sales of|profits?|earnings|net income|valuation|arr|mrr|makes? (about |around |roughly )?[$€£]?\d[\d.,]*\s*[kmb]?\s*(a|per) (year|month))\b/i },
  { id: "followers", always: false, reason: "Follower and subscriber counts are never estimated; only a source that states them can be cited.",
    // A COUNT (a number, or "thousands/millions of", near the word), a following, a reach or an audience size; plain wording
    // such as "bread box subscribers" is not a count (2026-10-24 paid run: the old pattern removed it).
    pattern: /(\d[\d.,]*\s*[kmb]?\+?\s*(?:[\p{L}-]+\s+){0,2}(followers?|subscribers?|fans|members)\b|\b(followers?|subscribers?)\s+(?:of|at|count|number|total|reach(?:es|ed)?|grew|rose)\b[^.]{0,30}\d|\b(?:hundreds|thousands|millions|tens of thousands) of (?:[\p{L}-]+\s+)?(followers?|subscribers?|fans)\b|\b(?:large|huge|big|growing|loyal) (?:online |social )?following\b|\bfollowing of\b|\bsocial reach\b|\baudience of [\d.,]+\s*[kmb]?\b)/iu },
  { id: "demographics", always: false, reason: "Customer demographics are never inferred; only a source that states them can be cited.",
    pattern: /\b(aged? ?\d{1,2}|\d{1,2}\s?(-|–|to)\s?\d{1,2}(-| )?(year(-| )olds?|years? old)|millennials?|gen[ -]?[zxy]|boomers?|household income|income (brackets?|levels?)|ethnic\w*|demographics?|\d{1,3}\s?% (of )?(their |its |the )?(customers|audience|visitors|clients|buyers)|(mostly|predominantly|majority|largely) (women|men|female|male))\b/i },
] as const;
export type GuardHit = { id: (typeof GUARDS)[number]["id"]; always: boolean; reason: string; term: string };
/** What a removed guarded claim is called in the brief: its words are not repeated, so an invented figure never resurfaces. */
export const GUARD_LABEL: Record<GuardHit["id"], string> = { private: "A claim about private profiles or data", revenue: "A financial figure", followers: "A follower or subscriber count", demographics: "A claim about customer demographics" };
export function guardHit(text: string): GuardHit | null {
  for (const guard of GUARDS) { const match = guard.pattern.exec(text); if (match) return { id: guard.id, always: guard.always, reason: guard.reason, term: match[0].toLowerCase() }; }
  return null;
}

export const normalizeQuote = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, "\"").replace(/[–—]/g, "-").replace(/…/g, "...").replace(/\s+/g, " ").trim();
const MIN_QUOTE = 8;
function resolve(citation: { source: string; quote: string }, material: Material): { ok: true; source: MaterialSource; citation: StoredCitation } | { ok: false; excluded: boolean } {
  const source = material.sources.find(item => item.id === citation.source);
  if (!source) return { ok: false, excluded: false };
  if (source.excluded) return { ok: false, excluded: true };
  const quote = normalizeQuote(citation.quote), haystack = normalizeQuote(source.text);
  if (!quote || quote.length < Math.min(MIN_QUOTE, haystack.length) || !haystack.includes(quote)) return { ok: false, excluded: false };
  return { ok: true, source, citation: { source: source.id, quote: citation.quote.trim().slice(0, 300), title: source.title.slice(0, 300),
    ...(source.url ? { url: source.url } : {}), ...(source.fetchedAt ? { fetchedAt: source.fetchedAt } : {}), ...(source.stale ? { stale: true } : {}) } };
}

/** A guarded claim survives only when its own quotes state the same term and every figure. */
function statedBySources(text: string, hit: GuardHit, quotes: readonly string[]) {
  const joined = normalizeQuote(quotes.join(" \n "));
  const figures = text.match(/\d[\d.,]*\s*[kmb%]?/gi)?.map(figure => normalizeQuote(figure).replace(/[.,]$/, "")) ?? [];
  const keyword = hit.term.replace(/[\d.,]+/g, "").trim();
  return joined.includes(keyword.split(/\s+/)[0] ?? keyword) && figures.every(figure => joined.includes(figure));
}

type Removed = { text: string; reason: string };
function groundClaim(claim: ModelClaim, id: string, material: Material, removed: Removed[], allowed?: (source: MaterialSource) => boolean): StoredClaim | null {
  const text = claim.text.trim().slice(0, 400);
  const results = (claim.citations ?? []).map(citation => resolve(citation, material));
  const resolved = results.filter((item): item is Extract<typeof item, { ok: true }> => item.ok && (!allowed || allowed(item.source)));
  const onlyExcluded = results.length > 0 && !resolved.length && results.every(item => !item.ok && item.excluded);
  const hit = guardHit(`${text} ${claim.reasoning ?? ""}`);
  if (hit && (hit.always || claim.basis !== "fact" || !resolved.length || !statedBySources(text, hit, resolved.map(item => item.citation.quote)))) {
    removed.push({ text: GUARD_LABEL[hit.id], reason: hit.reason }); return null;
  }
  if (onlyExcluded) { removed.push({ text, reason: "Its only source may describe a different business." }); return null; }
  const citations = resolved.map(item => item.citation).slice(0, 4);
  if (claim.basis === "fact" && !citations.length)
    return { id, text, basis: "inference", citations: [], note: "Shown as an inference: no source states this word for word." };
  return { id, text, basis: claim.basis, citations, ...(claim.basis === "inference" ? { note: (claim.reasoning ?? "Concluded from the sources, not stated in them.").slice(0, 300) } : {}) };
}

const idFor = (section: string, index: number) => `c-${section.toLowerCase()}-${index}`;

export function groundBrief(raw: unknown, material: Material, meta: { method: ResearchBrief["method"]; generatedAt: string; limits: ResearchBrief["limits"] }): ResearchBrief {
  const parsed: ParsedModelBrief = ModelBriefSchema.parse(raw);
  const removed: Removed[] = [];
  const refs = new Map<string, string>();
  const sections = Object.fromEntries(SECTIONS.map(section => [section, [] as StoredClaim[]])) as Record<Section, StoredClaim[]>;
  const seen = new Set<string>();
  for (const section of SECTIONS) {
    parsed[section].forEach((claim, index) => {
      const key = normalizeQuote(claim.text);
      if (seen.has(key)) return;
      const grounded = groundClaim(claim, idFor(section, sections[section].length), material, removed);
      if (!grounded) return;
      seen.add(key); refs.set(`${section}:${index}`, grounded.id); sections[section].push(grounded);
    });
  }
  const competitors: ResearchBrief["competitors"] = [];
  parsed.competitors.forEach((competitor, index) => {
    const source = material.sources.find(item => item.id === competitor.source);
    if (!source || source.kind !== "page" || source.role !== "competitor" || source.excluded || !source.url) {
      removed.push({ text: competitor.name, reason: "Competitors come only from competitor links that were supplied and read." }); return;
    }
    const slot = competitors.length;
    const claims = competitor.claims.map((claim, claimIndex) => {
      const grounded = groundClaim(claim, idFor(`competitor.${slot}`, claimIndex), material, removed, item => item.id === source.id);
      if (grounded) refs.set(`competitors.${index}:${claimIndex}`, grounded.id);
      return grounded;
    }).filter((claim): claim is StoredClaim => Boolean(claim));
    competitors.push({ name: competitor.name.slice(0, 120), url: source.url, source: source.id, claims });
  });
  const recommendations: ResearchBrief["recommendations"] = [];
  for (const item of parsed.recommendations) {
    const hit = guardHit(`${item.title} ${item.reason}`);
    if (hit) { removed.push({ text: `A recommendation (${GUARD_LABEL[hit.id].toLowerCase()})`, reason: hit.reason }); continue; }
    recommendations.push({ deliverable: item.deliverable, title: item.title, reason: item.reason, basedOn: item.basedOn.map(ref => refs.get(ref)).filter((ref): ref is string => Boolean(ref)) });
  }
  if (!recommendations.length) recommendations.push({ deliverable: "other", title: "Confirm the details first", basedOn: [],
    reason: "There isn't enough confirmed information yet to recommend a deliverable. Answer the open questions, then run this again." });

  const questions = [...parsed.questions.filter(question => !guardHit(question))];
  if (!sections.audience.length) questions.push("Who are their main customers? No source says who the business is for.");
  if (!material.sources.some(source => source.kind === "page" && source.role === "home" && !source.excluded)) questions.push("Can you share their website content another way? Their site could not be read.");
  if (!competitors.length) questions.push("Who do they compete with? Add competitor links to compare them (web search isn't available yet).");
  for (const note of material.identity.status === "conflict" ? material.identity.notes.slice(0, 2) : []) questions.push(`Same business? ${note}`.slice(0, 240));
  const brief: ResearchBrief = {
    version: RESEARCH_VERSION, method: meta.method, generatedAt: meta.generatedAt,
    client: { id: material.client.id, name: (material.client.company || material.client.name).slice(0, 200), url: material.client.url },
    sections, competitors, questions: [...new Set(questions.map(question => question.slice(0, 240)))].slice(0, 16), recommendations,
    identity: material.identity, sources: sourceViews(material), inaccessible: material.inaccessible.slice(0, 30), notRead: material.notRead.slice(0, 30),
    search: { performed: false, reason: SEARCH_REFUSED_REASON }, plan: material.plan.slice(0, 10), removed: removed.slice(0, 60),
    knowledge: material.knowledge, limits: meta.limits,
  };
  return brief;
}
