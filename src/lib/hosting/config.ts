export const HOSTING_HOST = "sites.makeborne.com";
export const HOSTING_ORIGIN = `https://${HOSTING_HOST}`;
export const SITE_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
export const RESERVED_SITE_SLUGS = new Set(["admin", "api", "auth", "billing", "login", "studio", "support", "www", "makeborne", "robots-txt", "sitemap-xml"]);
export function validSiteSlug(value: string) { return SITE_SLUG.test(value) && !RESERVED_SITE_SLUGS.has(value); }
export function siteAddress(slug: string) { return `${HOSTING_ORIGIN}/${slug}`; }
export type HostedSite = { slug: string; live: boolean; version_number: number; revision: number; updated_at: string };
