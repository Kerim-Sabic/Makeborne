import { RESERVED_SITE_SLUGS as RESERVED, SITE_SLUG as SLUG, validSiteLabel } from "../../../infra/customer-sites/site-policy";

/** Every published site gets its own origin on a dedicated registrable domain,
 * so site JavaScript can never reach Makeborne cookies, storage or sessions.
 * Override for local qualification, e.g. `http://{slug}.localhost:8787/`. */
const DEFAULT_SITE_URL_TEMPLATE = "https://{slug}.makeborne.site/";
function siteUrlTemplate() {
  const configured = process.env.NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE;
  if (!configured || configured.split("{slug}").length !== 2) return DEFAULT_SITE_URL_TEMPLATE;
  if (/^https:\/\/\{slug\}\.[a-z0-9.-]+\/$/.test(configured)) return configured;
  if (/^http:\/\/\{slug\}\.localhost(?::\d{2,5})?\/$/.test(configured)) return configured;
  return DEFAULT_SITE_URL_TEMPLATE;
}
export const SITE_URL_TEMPLATE = siteUrlTemplate();
/** Text shown around the editable address label in the publish form. */
export const SITE_ADDRESS_PARTS = (() => {
  const [before, after] = SITE_URL_TEMPLATE.split("{slug}");
  return { before: before.replace(/^https:\/\//, ""), after: after.replace(/\/$/, "") };
})();
export const SITE_SLUG = SLUG;
export const RESERVED_SITE_SLUGS = new Set<string>(RESERVED);
export function validSiteSlug(value: string) { return validSiteLabel(value); }
export function siteAddress(slug: string) { return SITE_URL_TEMPLATE.replace("{slug}", slug); }
export type HostedSite = { slug: string; live: boolean; version_number: number; revision: number; updated_at: string; interactive: boolean; scripted: boolean };
