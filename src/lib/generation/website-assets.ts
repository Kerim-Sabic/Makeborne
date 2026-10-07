/** Curated public concept imagery. Never accept a model-invented asset URL. */
export const WEBSITE_IMAGE_ASSETS = [
  { url: 'https://makeborne.com/generated/good-dog-v2/coastal-dog.webp', description: 'Golden retriever in a moss collar on a coastal path; landscape lifestyle hero.' },
  { url: 'https://makeborne.com/generated/good-dog-v2/moss-collar.webp', description: 'Moss woven collar with silver hardware on a sage surface; product concept.' },
  { url: 'https://makeborne.com/generated/good-dog-v2/clay-lead.webp', description: 'Terracotta woven lead with silver hardware on a clay surface; product concept.' },
] as const;

const approvedImages = new Set<string>(WEBSITE_IMAGE_ASSETS.map(asset => asset.url));
export function isApprovedWebsiteImage(url: string): boolean { return approvedImages.has(url); }
export const websiteImageCsp = WEBSITE_IMAGE_ASSETS.map(asset => asset.url).join(' ');

export function websiteAssetInstructions(brief: string): string {
  // This pilot library is relevant only to dog-accessory briefs. Other businesses
  // must not receive unrelated imagery or fabricated photo URLs.
  if (!/\b(dog|dogs|canine)\b/i.test(brief) || !/\b(collar|collars|lead|leads|accessories|good dog)\b/i.test(brief)) return 'No approved photographic assets are available for this brief. Build a considered typographic design; do not fake product photographs with CSS loops or invent image URLs.';
  return `APPROVED CONCEPT IMAGERY (AI-generated, not verified merchandise photographs): ${JSON.stringify(WEBSITE_IMAGE_ASSETS)}. Use these exact URLs in semantic img elements with descriptive alt text, width=1440 height=960. Use the lifestyle photograph as the visual anchor and product concepts in collection sections. No other image URLs. Do not assert that depicted specifications, colors or materials are available for sale; this is a fictional concept store. Do not place the same hero image in every section.`;
}
