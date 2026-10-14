import { CREATION_PLANS, YEARLY_DISCOUNT_PERCENT } from "@/lib/billing/plans";
import { IS_PREVIEW, SITE, SITE_FACTS } from "@/lib/site-metadata";
import { HELP_ARTICLES } from "@/lib/help/articles";

export const dynamic = "force-static";

/**
 * /llms.txt: a plain, factual overview for AI answer engines (the llmstxt.org
 * convention). Built from the same facts and live plan data as the site, so it
 * never drifts from what the pages say.
 */
export function GET() {
  const plans = CREATION_PLANS.map(plan => `- ${plan.name}: US$${plan.monthlyCents / 100} per month, ${plan.monthlyCredits} credits per month. ${plan.description}`).join("\n");
  const guides = HELP_ARTICLES.map(article => `- [${article.title}](${SITE.url}/help/${article.slug}): ${article.answer}`).join("\n");
  const body = `# ${SITE.name}

> ${SITE_FACTS.summary}

Who it's for: ${SITE_FACTS.audience}

## What you can make
${SITE_FACTS.makes.map(item => `- ${item}`).join("\n")}

## Client CRM and outreach
${SITE_FACTS.crm.map(item => `- ${item}`).join("\n")}

## Expert advisors
- ${SITE_FACTS.advisors}

## Pricing
${plans}
- Yearly billing is ${YEARLY_DISCOUNT_PERCENT}% below twelve monthly payments. Prices are in US dollars, before tax.
- Credits pay for AI work (generation, personalised emails, lead finding, advisor answers). Sending email, publishing, single-profile research and the CRM itself use no credits.
- Unused plan credits carry over for two months after their month ends. Extra credit packs are available.
- Status: creation plans open at launch; checkout appears on the pricing page when it opens.

## Key pages
- [Home](${SITE.url}/): start a website, book or presentation from a short brief.
- [Pricing](${SITE.url}/billing): plans, credits and common questions.
- [Help center](${SITE.url}/help): step-by-step guides with short demos.
- [Privacy](${SITE.url}/privacy): how account information, project content and published websites are handled.
- [Subscriptions, pricing and refunds](${SITE.url}/billing/terms)

## Guides
${guides}

## Contact
- admin@makeborne.com
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600", ...(IS_PREVIEW ? { "X-Robots-Tag": "noindex" } : {}) } });
}
