/** Shared static-site policy for the renderer and Cloudflare delivery boundary.
 * Keep this module within the Pages bundle so deployments include it.
 */
export const WEBSITE_IMAGE_ASSETS = Object.freeze([
  Object.freeze({
    url: "https://makeborne.com/generated/good-dog-v2/coastal-dog.webp",
    description: "Golden retriever in a moss collar on a coastal path; landscape lifestyle hero.",
  }),
  Object.freeze({
    url: "https://makeborne.com/generated/good-dog-v2/moss-collar.webp",
    description: "Moss woven collar with silver hardware on a sage surface; product concept.",
  }),
  Object.freeze({
    url: "https://makeborne.com/generated/good-dog-v2/clay-lead.webp",
    description: "Terracotta woven lead with silver hardware on a clay surface; product concept.",
  }),
]);

export const websiteImageCsp = WEBSITE_IMAGE_ASSETS.map(asset => asset.url).join(" ");

// The HTTP policy and document policy intersect. Both must permit curated
// imagery, while arbitrary remote resources and executable content stay denied.
export const CUSTOMER_SITE_CSP = `sandbox; default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: ${websiteImageCsp}; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
