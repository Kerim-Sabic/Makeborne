# Review notes: legal documents (26 October 2026)

The documents are drafted from the code (`release/minimum-launch-20261025` at 0877345 and the full candidate at 4974b9c) and from providers' public terms. This is not advice from a licensed lawyer. A local lawyer in Bosnia and Herzegovina should still confirm the points below. The final documents are in `docs/legal/` on branch `claude/legal-pages`.

## Findings that matter

1. **Whop is not the merchant of record for consumer law.**
   - Whop's Seller Terms §1 (last updated 14 July 2026) say: "Whop acts as merchant of record for the purpose of card network rules and payment settlement only". The seller "is the supplier of the Products for all other purposes, including for value-added tax, sales tax, consumer protection, and content licensing".
   - Refund decisions are "yours alone" (§5).
   - Under §6A, "Whop Collects and Remits" mode makes Whop collect and remit VAT and sales tax in the EU, the UK and 18 US states. The seller stays ultimately liable.
   - The Seller Data Sharing Addendum makes Whop and the seller **independent controllers**, with SCC Module 1 for Whop→seller transfers.
   - Whop's terms say nothing about consumer withdrawal consent. Makeborne therefore collects it itself.
2. **Vercel Hobby forbids commercial use.**
   - Vercel's fair-use guidelines say: "Hobby teams are restricted to non-commercial personal use only". The repo docs (`docs/HOSTING.md`, AGENT_HANDOFF 14 and 19 Oct) record the team as Hobby.
   - Vercel's DPA applies only to Pro and Enterprise customers.
   - **Upgrade to Pro before paid launch.** Otherwise there is no Art. 28 contract with the app host, and its terms are breached.
3. **Lead research reads Instagram, TikTok and YouTube pages from the server.**
   - `src/lib/leads/enrich.ts` sends a preset YouTube consent cookie (`SOCS=CAI; CONSENT=YES+1`).
   - Those platforms' terms restrict automated collection. This is a contract and ToS risk for Makeborne, not a GDPR one.
   - Creator discovery is off at launch, but list mode still reads profiles.
4. **A shared in-memory Overpass cache** (`src/lib/leads/osm.ts`, 6 hours, 200 entries) can return one customer's public OSM listing response to another customer who runs the same query. The data is public and not persisted, which is acceptable; the DPA does not promise strict per-tenant caching.
5. **No undisclosed tracker was found.**
   - There are no Google Fonts (fonts are self-hosted), no third-party scripts, and no cookies before sign-in.
   - Published sites have a strict CSP and no third-party resources.
   - Analytics is the first-party, cookieless daily hash.
   - No provider trains on API data: Anthropic Commercial Terms §B ("may not train models on Customer Content"); OpenAI API data controls ("not used to train").
6. **The EU withdrawal button (CRD Art. 11a) has applied since 19 June 2026.** It was added by Directive (EU) 2023/2673. `/withdraw` provides a "Withdraw from contract here" button that opens a prefilled email. A proper confirmation step with an automatic durable-medium acknowledgement is a Codex follow-up.

## For a local lawyer (Bosnia and Herzegovina)

1. **BiH Law on Personal Data Protection** (Official Gazette BiH 12/25, published 28 February 2025). It applies from about 4 October 2025; sources differ by a day. Confirm:
   - its transfer rules for exports from BiH to the US, Singapore (Supabase Pte. Ltd.) and the UK;
   - whether the AZLP must be notified of anything.
2. **EU→BiH transfers.** BiH has no EU adequacy decision; the Commission's list was checked on 26 October 2026 and no Western Balkan country is on it. The DPA incorporates SCC Module 2 and Module 3.
   - Open point: the 2021 SCCs are not designed for importers already subject to the GDPR under Art. 3(2).
   - The Commission has been preparing additional clauses for that case. Check their status and switch when they are adopted.
3. **Consumer law.** Confirm the BiH Consumer Protection Law's distance-selling rules for domestic consumers (withdrawal period, information duties, language). BiH consumers may require local-language information.
4. **Enforcement of Sarajevo court judgments in the EU.** For B2B, consider arbitration if this matters; check the Hague Choice of Court Convention status.
5. **Bookkeeping retention** in the Federation of BiH. The documents use 10 years for financial records; confirm the statutory period.
6. **VAT.**
   - If ZORBY&CO is not registered for BiH PDV, check whether foreign B2C digital services create BiH or foreign registration duties.
   - Outside the Whop-supported jurisdictions, check whether the non-Union OSS (EU) or a UK VAT registration is needed.
7. **Language.** English only. Some countries require local-language consumer terms (for example France and Poland). If sales grow there, translate.
8. **AI Act Art. 50** (transparency for AI-generated content, applicable from 2 August 2026; check whether the Digital Omnibus changed the date).
   - Makeborne is a provider of an AI system that generates text and images.
   - Consider machine-readable marking: a `generator` meta tag on published sites, and C2PA or metadata on generated images.
   - The Terms tell customers to label AI content where the law requires it.
9. **Price display.** EU and UK consumers must see tax-inclusive prices. `TAX_NOTE` in `src/lib/billing/plans.ts` still says "plus any tax". Flip it when the Whop tax-inclusive setting is on (prerequisite already listed in `docs/WHOP_ACCESS_SETUP.md`).
10. **Germany.**
    - Online subscriptions need a cancellation button (§312k BGB). Cancellation is in Whop; check that it qualifies.
    - Yearly auto-renewal for German consumers must become cancellable monthly after the first term (§309 Nr. 9 BGB).
11. **US state privacy laws.** The Privacy Policy describes rights honestly and does not claim any threshold status.
12. **DSA classification.** Makeborne hosting is a hosting service (Art. 16 and 17 apply). The micro or small enterprise exemption (Art. 19) covers the online-platform duties if it is classed as a platform.

## Verify (code or provider facts not fully confirmed)

- verify: Supabase DPF status. Its DPA names Supabase Pte. Ltd., Singapore, and incorporates SCC Modules 2 and 3 plus the UK Addendum. Also verify how the DPA is executed: in the dashboard or by request.
- verify: Supabase plan and backup window (Free has no downloadable backups; Pro keeps 7 days). Annex II says "provider backups" without a period.
- verify: Vercel Sandbox build region. Pricing examples cite `iad1`, so it is assumed US.
- verify: Cloudflare R2 bucket location hint; jurisdiction endpoints are not used (`infra/project-runtime/R2_OUTPUT.md`). Also verify that the self-serve DPA has been accepted in the Cloudflare dashboard.
- verify: Anthropic and OpenAI DPF status. Their DPAs use SCCs, and the documents rely only on SCCs. Check which Anthropic entity contracts with a BiH customer.
- verify: the OpenAI DPA is executed before images are switched on.
- verify: the operators of the Overpass mirrors `overpass.kumi.systems` and `overpass.private.coffee`. They receive only search terms, not user data.
- verify: Gmail sending is live. Production is `send_only`, automation is `false`, and the Google OAuth app is still "Testing" (AGENT_HANDOFF, 14–19 Oct). The documents describe it as "if you connect it".
- verify: whether account export and deletion are switched on (`MAKEBORNE_ACCOUNT_EXPORT`, `MAKEBORNE_ACCOUNT_DELETION`, branch `claude/account-data-rights`). The documents say "where shown".
- verify: OAuth sign-ups (Google and GitHub) cannot store the accepted Terms version through `signUp` data. Record it on first sign-in if needed.
- verify: the court register number (MBS), PDV status and director. CompanyWall shows none of them.

## Sources consulted (26 October 2026)

- Whop Terms of Service (last updated 9 Oct 2026): https://whop.com/tos/
- Whop Seller Terms (14 Jul 2026): https://whop.com/seller-terms
- Whop Seller Data Sharing Addendum: https://whop.com/seller-data-sharing-addendum
- Whop tax docs: https://docs.whop.com/sales-tax
- CompanyWall BiH, ZORBY&CO d.o.o. (JIB 4203428970007, founded 16 Jul 2025, activity G 47.91): https://www.companywall.ba/firma/zorbyco-drustvo-sa-ogranicenom-odgovornoscu/MMxPqvYTq
- Anthropic Commercial Terms: https://www.anthropic.com/legal/commercial-terms
- Anthropic DPA: https://www.anthropic.com/legal/data-processing-addendum
- Anthropic API retention: https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
- OpenAI API data controls: https://developers.openai.com/api/docs/guides/your-data
- Supabase DPA: https://supabase.com/legal/dpa
- Vercel DPA: https://vercel.com/legal/dpa
- Vercel fair-use guidelines: https://vercel.com/docs/limits/fair-use-guidelines
- Vercel Sandbox: https://vercel.com/docs/vercel-sandbox
- Cloudflare customer DPA: https://www.cloudflare.com/cloudflare-customer-dpa/
- Resend DPA: https://resend.com/legal/dpa
- DigitalOcean DPA: https://www.digitalocean.com/legal/data-processing-agreement
- EU adequacy decisions: https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/adequacy-decisions_en
- ODR platform closure (Regulation (EU) 2024/3228), commentary: https://www.taylorwessing.com/en/insights-and-events/insights/2025/01/abolition-of-the-odr-platform and https://cms.law/en/svk/legal-updates/the-odr-platform-is-closing-what-businesses-need-to-know
- BiH data protection law, commentary: https://www.dlapiperdataprotection.com/index.html?c=BA&t=law and https://ceelm.com/jpm-jankovic-popovic-mitic/31249-new-personal-data-protection-law-enters-into-force-in-bosnia-and-herzegovina
- Repo: `docs/release-review/launch-site-sweep-20261026.md` (site-sweep), `docs/release-review/account-data-rights-20261026.md` (account-rights), `docs/WHOP_ACCESS_SETUP.md`, `docs/BILLING_PLAN_CREDITS.md`, `docs/release-review/full-launch-candidate-20261026.md`
