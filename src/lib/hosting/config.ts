import { RESERVED_SITE_SLUGS as RESERVED, SITE_SLUG as SLUG, validSiteLabel } from "../../../infra/customer-sites/site-policy";

/**
 * Where published websites live.
 *
 * - "legacy" (default): the existing addresses, `https://sites.makeborne.com/<slug>`,
 *   served by the existing static host. Static only: no customer JavaScript runs
 *   there, because sites.makeborne.com is part of the Makeborne application's site.
 * - "isolated": `https://<slug>.<domain>/` on a separate registrable domain, where
 *   each site gets its own origin and may run its JavaScript. Enabled only by
 *   explicit, validated configuration:
 *     NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING=isolated
 *     NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE=https://{slug}.<domain>/
 *     NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED=<domain>   (operator attests the
 *       prerequisites in docs/HOSTING_DOMAIN.md: DNS, HTTPS, Worker checks)
 *   Anything missing or invalid keeps the legacy addresses and is reported in
 *   `HOSTING.issues`. A local `http://{slug}.localhost:<port>/` template is
 *   accepted outside production for qualification.
 */
export type HostingMode = "legacy" | "isolated";
export const LEGACY_SITE_URL_TEMPLATE = "https://sites.makeborne.com/{slug}";
/** Domains that belong to the Makeborne application: never a customer-JavaScript host. */
const APPLICATION_DOMAINS = ["makeborne.com"];

export type HostingEnv = {
  NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING?: string;
  NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE?: string;
  NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED?: string;
  NODE_ENV?: string;
};
export type HostingConfig = {
  mode: HostingMode;
  /** Address template with exactly one `{slug}`. */
  template: string;
  /** Isolated site domain, when enabled. */
  domain: string | null;
  /** Customer JavaScript may run only on the isolated domain. */
  interactiveAllowed: boolean;
  /** Why an isolated configuration was not applied (empty when none was requested or it is valid). */
  issues: string[];
};

const legacy = (issues: string[]): HostingConfig => ({ mode: "legacy", template: LEGACY_SITE_URL_TEMPLATE, domain: null, interactiveAllowed: false, issues });
const isApplicationDomain = (domain: string) => APPLICATION_DOMAINS.some(app => domain === app || domain.endsWith(`.${app}`) || app.endsWith(`.${domain}`));

export function resolveHostingConfig(env: HostingEnv): HostingConfig {
  const mode = env.NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING?.trim();
  const template = env.NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE?.trim();
  if (!mode) return legacy(template ? ["NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE is ignored without NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING=isolated."] : []);
  if (mode !== "isolated") return legacy([`Unknown NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING "${mode}"; use "isolated" or leave it unset.`]);
  if (!template || template.split("{slug}").length !== 2) return legacy(["NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE must be https://{slug}.<domain>/ with exactly one {slug}."]);
  const local = /^http:\/\/\{slug\}\.(localhost)(?::\d{2,5})?\/$/.exec(template);
  if (local) {
    if (env.NODE_ENV === "production") return legacy(["A localhost site template is only allowed outside production."]);
    return { mode: "isolated", template, domain: "localhost", interactiveAllowed: true, issues: [] };
  }
  const match = /^https:\/\/\{slug\}\.((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})\/$/.exec(template);
  if (!match) return legacy(["NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE must be https://{slug}.<domain>/ (lowercase domain, trailing slash)."]);
  const domain = match[1];
  if (isApplicationDomain(domain)) return legacy([`${domain} belongs to the Makeborne application; customer sites need a separate registrable domain.`]);
  if (env.NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED?.trim() !== domain) {
    return legacy([`Set NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED=${domain} once the prerequisites in docs/HOSTING_DOMAIN.md are verified.`]);
  }
  return { mode: "isolated", template, domain, interactiveAllowed: true, issues: [] };
}

// Literal references so Next inlines the public variables into client bundles.
export const HOSTING = resolveHostingConfig({
  NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING: process.env.NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING,
  NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE: process.env.NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE,
  NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED: process.env.NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED,
  NODE_ENV: process.env.NODE_ENV,
});
export const SITE_URL_TEMPLATE = HOSTING.template;
/** Text shown around the editable address label in the publish form. */
export const SITE_ADDRESS_PARTS = addressParts(HOSTING.template);
export function addressParts(template: string) {
  const [before, after] = template.split("{slug}");
  return { before: before.replace(/^https?:\/\//, ""), after: after.replace(/\/$/, "") };
}
export const SITE_SLUG = SLUG;
export const RESERVED_SITE_SLUGS = new Set<string>(RESERVED);
export function validSiteSlug(value: string) { return validSiteLabel(value); }
export function siteAddress(slug: string, config: HostingConfig = HOSTING) { return config.template.replace("{slug}", slug); }
export type HostedSite = { slug: string; live: boolean; version_number: number; revision: number; updated_at: string; interactive: boolean; scripted: boolean };
