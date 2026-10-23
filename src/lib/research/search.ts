import { UnsupportedConfigurationError, WEB_SEARCH, serverToolBoundMicrousd } from "../ai/prices";

/**
 * The search seam for client research. It is present so the research flow has
 * one place to ask for missing or time-sensitive information, and it stays
 * REFUSED: the already-qualified configuration is "no web search", because
 * the price card (ai/prices.ts) refuses every web-search tool request — there
 * is no documented or provider-enforced ceiling on billable result tokens, so
 * no worst case can be reserved before a call.
 *
 * Asking goes through the same refusal the lead finder hits
 * (serverToolBoundMicrousd → assertWebSearchTool). Even if that refusal were
 * lifted, this module still answers SEARCH_NOT_WIRED: enabling search needs a
 * new, reviewed version of this file that passes the qualification plan in
 * docs/release-review/client-research-search-qualification-20261024.md
 * (pricing, usage shape, result-token ceiling, compatibility and failure tests).
 */
export const SEARCH_REFUSED_REASON = "Web search wasn't used: it isn't available yet. Only the client's own site, the links you supplied, your documents and saved knowledge were read.";
export const SEARCH_QUALIFICATION_PLAN = "docs/release-review/client-research-search-qualification-20261024.md";

export type SearchRequest = Readonly<{ purpose: "competitors" | "time_sensitive"; query: string; maxUses: number }>;
export type SearchOutcome = Readonly<{ performed: false; code: "SEARCH_NOT_QUALIFIED" | "SEARCH_NOT_WIRED"; reason: string }>;

export function researchSearch(request: SearchRequest, model: string = WEB_SEARCH.models[0]): SearchOutcome {
  const uses = Math.max(1, Math.min(WEB_SEARCH.maxUses, Math.floor(request.maxUses)));
  try {
    serverToolBoundMicrousd(model, [{ type: WEB_SEARCH.type, name: WEB_SEARCH.name, max_uses: uses }]);
  } catch (error) {
    if (error instanceof UnsupportedConfigurationError) return Object.freeze({ performed: false, code: "SEARCH_NOT_QUALIFIED", reason: SEARCH_REFUSED_REASON });
    throw error;
  }
  return Object.freeze({ performed: false, code: "SEARCH_NOT_WIRED", reason: SEARCH_REFUSED_REASON });
}
