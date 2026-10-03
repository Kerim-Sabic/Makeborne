# Provider decisions, proposed pricing and hosted-site architecture

Research date: 2026-10-03. **Planning proposal, not a live offer or launch-readiness claim.** No paid inference, hosting purchase or billing activation was performed. Read all 41 rows of the user-supplied `OPEN_SOURCE_AND_PROVIDER_REGISTER.csv` from Downloads. The standalone unit-economics workbook remains unavailable; the arithmetic below is a new transparent scenario, not a reconstruction of that workbook.

## 1. Decision

Ship the core product as a client workspace producing websites, books and presentations. Keep one canonical project/artifact/style model. Integrate narrow libraries through adapters; avoid embedding several complete applications with separate auth and databases. Prioritize persistent edits, export fidelity, trustworthy research and reliable delivery over the number of model logos.

Use OpenAI image generation for final book artwork and the requested complete visual slides. An economy text route may draft an outline; it must not silently replace required final OpenAI artwork. Offer visual slides and a separate editable presentation mode with clear export differences. Books retain selectable accessible body text wherever practical; illustrated pages need text validation and a text alternative. An image of tiny body text is not evidence of a readable book.

Current OpenAI documentation identifies `gpt-image-2.5-flare` for everyday generation and `gpt-image-2.5-sunburst` for precise edits. Treat these as integration candidates pending account access, explicit spending approval and artifact evaluations. Specify size/quality for quotes; do not quote the smallest output-only example as a finished-page price. Input images/text, variations, retries and partial previews affect costs. [OpenAI image guide](https://developers.openai.com/api/docs/guides/image-generation)

## 2. Current competitor and payment evidence

| Source checked | Verified observation | Makeborne decision |
|---|---|---|
| [Lovable pricing](https://lovable.dev/pricing) | Shared balance can fund building, hosted apps and app AI; task costs vary. Current retrieved page does not expose the paid plan price cards. | Copy the clarity of per-action usage history and shared workspace controls. Do not repeat old $25/100-credit figures as freshly verified, or imply our credits are comparable. |
| [Lovable usage documentation](https://docs.lovable.dev/introduction/credits-and-usage) | Dedicated documentation describes usage and credit accounting. | Show estimate before execution and actual charge/refund afterward; retain a readable project ledger. |
| [Bolt pricing](https://bolt.new/pricing) | Pro starts at $25/month billed monthly and 10M tokens; Teams starts at $30/member/month. Pro includes hosting and a stated request allowance. | Compete on complete client delivery and output quality; tokens are not a direct quality or cost comparison. |
| [Whop pricing](https://whop.com/network/pricing/) | Domestic cards: 2.7%+$0.30. Optional orchestration 0.8%, billing 0.5%, tax/remittance 2% can bring this to 6%+$0.30. International cards/FX and other events add costs. | First-cohort candidate only after actual entity approval and written fee settings. Model the configured total, including payout/dispute/affiliate exposure. |
| [Paddle pricing](https://www.paddle.com/pricing) | Published standard fee is 5%+$0.50. | Primary economic baseline and alternative for own SaaS subscriptions, subject to approval and contract. Creator marketplace proceeds are a separate business arrangement. |

Do not integrate all payment providers at once. A provider-neutral entitlement service consumes verified, idempotent webhook events; the initial checkout adapter is selected after onboarding. Whop may suit the intended community distribution, but distribution fit alone does not establish lower landed fees or seller eligibility. Customer taxes and any tax-inclusive advertised price must be accounted for before estimating revenue.

## 3. Exact PROPOSED monthly plans

USD prices before customer taxes. All features and allowances below are proposed limits pending measurements and implementation. Do not enable purchase buttons or advertise them as available until the corresponding flows work.

| Plan | Monthly price | Included generation credits | Active hosted static sites | Asset storage | Seats | Purpose |
|---|---:|---:|---:|---:|---:|---|
| Explore | $0 | No recurring paid generation grant | 0 | Local drafts only | 1 | Style previews, sample projects, local editing; optional invitation pilot separately funded |
| Create | $29 | 300 | 1 | 2 GB | 1 | Individual creator producing books, decks and a website |
| Studio | $79 | 1,000 | 5 | 10 GB | 3 | Client projects, shared review, version history and delivery |
| Scale | $199 | 2,800 | 15 | 30 GB | 5 | Higher client volume and usage controls |

All paid plans should include the three core formats and CRM; do not force an upgrade merely to export editable content. Advanced collaboration limits must reflect actually implemented permission controls. A hosted site is an active public deployment, not a draft; archiving a site releases its slot after safe retention. Custom domain registration is not included. Proposed initial request caps: 50k/250k/1M requests per workspace per month for Create/Studio/Scale, independently enforced and subject to load-test approval. No unlimited video streaming or dynamic databases are included in these static-site allowances.

Proposed top-up: $20 for 500 generation credits, no automatic purchase. Monthly included credits last through the following billing period; purchased credits last 12 months, subject to applicable consumer terms. Display expiry and consume earliest-expiring credits first. Accrued credits represent future service obligations: maintain a funded cost reserve and test concentrated rollover redemption. Do not rely on unused credits or forfeiture to make the plans viable. No annual discount until measured retention and cost distributions support one.

### Cost control, not a fictional exchange rate

Internal admission ceiling: **$0.015 of fully loaded incremental job cost per charged generation credit**. This is a proposed operating policy, not a supplier price or customer cash entitlement. Quote `ceil(conservative maximum job cost / 0.015)` credits. Include model inputs/outputs, bounded retries, retrieval calls, rendering/encoding, storage writes and a measured uncertainty allowance. Display the maximum before execution; reserve it atomically. Settle the actual metered cost under the versioned policy and release unused reservation. Charge no more than the accepted maximum. Platform failures refund customer credits while still counting vendor cost against the platform failure reserve.

Examples are arithmetic only: a maximum job cost of $0.45 requires 30 credits; $3 requires 200 credits. They are not measured prices of a book, deck or website. Do not publish fixed book/slide counts without fixtures for word count, number of images, image quality, model, attempts and export mode. Per-job maximum vendor budgets: Create $2, Studio $5, Scale $10 initially; larger work requires an explicit staged quote and available funded credits, not an automatic tier upsell.

Two ceilings apply: available customer credits and remaining platform/vendor cash budget. Both must cover worst-case admitted work including concurrent reservations. Provider price changes invalidate old quotes, never silently increase an approved bill. Per-workspace concurrency initially 1/2/3; cancellation prevents undispatched stages, while already incurred provider cost remains tracked. Hard limits must run server-side in one atomic reservation/settlement ledger; a UI balance alone is insufficient.

### Full-redemption scenario

Assume every monthly credit is redeemed at the admission ceiling. Paddle baseline fee `0.05 × price + $0.50`. Hosting/storage allocations and support/risk reserves below are assumptions, not invoices or measured costs. Taxes are excluded from the modeled subscription price; salaries, fixed tooling, legal costs and acquisition are not included in contribution.

| Per account per month | Create | Studio | Scale |
|---|---:|---:|---:|
| Subscription | $29.00 | $79.00 | $199.00 |
| Baseline payment fee | $1.95 | $4.45 | $10.45 |
| Receipts after fee | $27.05 | $74.55 | $188.55 |
| Generation cost at full redemption | $4.50 | $15.00 | $42.00 |
| Hosting/storage allocation | $1.00 | $3.00 | $8.00 |
| Variable support allowance | $2.00 | $5.00 | $12.00 |
| Risk/failure reserve, 3% of subscription | $0.87 | $2.37 | $5.97 |
| Contribution before fixed costs/acquisition | **$18.68** | **$49.18** | **$120.58** |
| Contribution / subscription | 64.4% | 62.3% | 60.6% |

At Whop's illustrated fully-enabled domestic 6%+$0.30, fees become $2.04/$5.04/$12.24 and contribution becomes $18.59/$48.59/$118.79, before other applicable fees. Neither scenario establishes profitability. A 20% affiliate commission would additionally consume $5.80/$15.80/$39.80, before affiliate processing fees. Do not promise lifetime 30–50% commissions with these allowances.

A $20/500-credit top-up at maximum cost uses $7.50 generation cost, $1.50 baseline payment fees and a $0.60 risk allocation, leaving $10.40 before support/fixed costs. Maintain minimum top-up size to avoid fixed-fee erosion. At double the assumed generation cost with unchanged prices, contribution falls to $14.18/$34.18/$78.58; this is a stop-and-reprice signal, not permission to degrade requested quality silently. Break-even paying accounts = monthly fixed costs divided by the weighted contribution per account, then adjusted for actual acquisition, refunds and churn. No growth or profit guarantee is made.

## 4. All 41 register decisions

Adopt means selected direction pending required engineering/quality/license gates, not installed or cleared for launch. Evaluate means a bounded fixture comparison. Defer means not in the first launch dependency path. Reject applies to the proposed use under current evidence, not every possible licensed use. License observations in the supplied register are historical evidence dated 2026-10-02; this pass did not re-audit every repository or transitive dependency. All pinned-commit fields in the supplied file are empty: pin exact versions and archive license/model cards before copying code or serving weights.

| ID | Component | Decision | Scope / gate |
|---|---|---|---|
| OSS01 | Puck | Adopt | Visual editing of owned React sections via canonical SiteSpec; [current repository](https://github.com/puckeditor/puck) reviewed. Spike round-trip edits before UI integration. |
| OSS02 | OpenCut classic | Evaluate | Timeline/crop/caption modules only; pin classic commit, audit assets/dependencies. |
| OSS03 | OpenCut rewrite | Defer | Roadmap/API availability is not a production dependency. |
| OSS04 | ClipsAI | Evaluate | Transcript-first segment suggestions; compare context fidelity and reframing on approved media. |
| OSS05 | faster-whisper | Adopt | Bounded transcription worker after multilingual/timing fixtures; [repository](https://github.com/SYSTRAN/faster-whisper) reviewed. No inherited speed claim. |
| OSS06 | WhisperX | Evaluate | Alignment only when caption timing requires it; separate gated checkpoint review. |
| OSS07 | PySceneDetect | Adopt | Shot-boundary feature, not semantic clip scoring. |
| OSS08 | FFmpeg | Adopt | Exact build/config/license audit, argument arrays, resource-limited worker; codec obligations reviewed separately. |
| OSS09 | MediaPipe | Evaluate | Composition landmarks; model-specific licenses, no identity inference. |
| OSS10 | Remotion | Defer | Current commercial eligibility and quote required before choosing over simpler captions. |
| OSS11 | OpenShorts core | Evaluate | Audited modules outside cloud/ only; no whole-app transplant. |
| OSS12 | OpenShorts cloud/ | Reject | Do not copy into paid hosted product without written license. |
| OSS13 | ClippyMe | Defer | Reference only; not internet-facing backend. |
| OSS14 | Ultralytics YOLO | Reject | Not required initially; proprietary integration/license path unresolved. |
| OSS15 | Docling | Adopt | Selective import with page/source provenance and resource limits; native text first. |
| OSS16 | Presenton | Evaluate | Compare export modules and templates; retain one DeckSpec and existing native PPTX route. |
| OSS17 | Diffusers | Defer | Optional model worker after demand; pinned pipelines and separately cleared weights. |
| OSS18 | ComfyUI | Defer | Internal R&D only, no arbitrary nodes in hosted product. |
| MODEL01 | FLUX.2 klein 4B | Evaluate | [Exact 4B model card](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) reviewed; optional economy previews, never silent replacement of OpenAI final art. |
| MODEL02 | FLUX.2 klein 9B | Reject | No default commercial use under register evidence; distinct license from 4B. |
| MODEL03 | Qwen-Image-2512 | Evaluate | Secondary image fixtures only; exact weights/license and GPU cost before serving. |
| MODEL04 | Qwen-Image-Edit-2511 | Evaluate | Optional edits; reference permissions and reproducible provenance. |
| MODEL05 | Wan2.2 TI2V-5B | Defer | Separately metered B-roll beta, hosted first; not included unlimited video. |
| MODEL06 | LTX-2.x / 2.5+ | Defer | Exact community/commercial agreement review before any use. |
| MODEL07 | Qwen3-8B | Evaluate | Bounded classification/extraction; check accuracy and fully loaded cost, not just license. |
| OSS19 | vLLM | Defer | Dedicated serving only after utilization makes idle GPU economics preferable. |
| OSS20 | llama.cpp | Evaluate | Development/local bounded tasks, quantization provenance and quality gates. |
| API01 | OpenAI GPT Image | Adopt | Required final book/visual-slide art; explicit quality, model version, quotation and approval. |
| API02 | OpenAI / Anthropic text | Adopt | Primary text candidates; choose exact model by artifact tests, versioned prices and provider access. |
| API03 | DeepSeek | Evaluate | Price endpoint failed again this pass; no verified rates and no default route until processing terms/quality checked. |
| API04 | fal | Evaluate | Hosted open-model comparison with endpoint-specific quote; no idle GPU commitment. |
| API05 | Runpod Serverless | Defer | Own pinned workers when economics justify cold-start/idle/storage costs. |
| API06 | Brave Search | Adopt | First research adapter candidate after plan/storage-rights check; fetch permitted evidence and cite claims. |
| API07 | Modash | Defer | Approved API/data agreement and budget required; keep manual CRM useful independently. |
| INFRA01 | Cloudflare R2 | Adopt | Larger media/releases through one asset abstraction; explicit auth gateway, no assumed Supabase RLS inheritance. |
| INFRA02 | Resend | Adopt | Transactional provider candidate after verified domain; no unsolicited campaigns. |
| INFRA03 | Turnstile | Adopt | Public intake and abuse controls with server verification, hostname/action checks and rate limits. |
| PAY01 | Whop | Evaluate | First-cohort distribution/payment fit; actual onboarding and stacked fees determine selection. |
| PAY02 | Paddle | Evaluate | Own SaaS MoR alternative and cost baseline; approval required. |
| PAY03 | Lemon Squeezy | Defer | Backup only; avoid simultaneous billing implementations. |
| PAY04 | Stripe direct | Defer | Actual legal entity eligibility first; recipient payouts do not imply merchant account support. |

For deferred/license-sensitive rows, retain the exact source URLs and restrictions from the supplied CSV as the implementation checklist; this proposal does not supersede their restrictions.

## 5. Hosted websites: proposed delivery path

### First release: managed static websites

Keep the app/auth/database on the chosen app platform and Supabase; deploy customer sites through a separate serving boundary. Generate constrained SiteSpec, render approved components, compile in a sandbox, inspect resulting files, and publish immutable static release bundles to private R2. Each release has tenant/project/version IDs, source/asset provenance, content hashes, build logs and a manifest. Reject path traversal, unsafe redirects, secret leakage and disallowed executable content before upload. Do not execute generated server code inside the Makeborne application process.

An edge router maps only verified hostnames to approved site releases. Resolve host ownership from authoritative mappings, never an arbitrary Host-derived bucket path. Use a separate registrable domain for customer content, host-only admin cookies, CSP and sandboxed previews, so customer scripts cannot read studio sessions. Forms call narrow tenant-aware endpoints with origin checks, rate limits, spam controls and field bounds. Public client sites must never expose service keys or direct privileged database access.

Custom domains require DNS ownership verification, certificate issuance/renewal state and a stable release mapping. A pending domain is not labeled live. Remove mappings and invalidate routing on removal; require fresh ownership proof before reassignment. Start with documented CNAME subdomains; do not promise all apex/wildcard configurations on every plan. [Cloudflare for SaaS plans](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/) list 100 included custom hostnames and $0.10 per additional hostname on standard plans; this covers hostname service, not complete app hosting or domain registration.

Publish is an idempotent job: prepare immutable bundle, run checks, then atomically swap the site's active release pointer. Rollback selects an existing verified release without rebuilding. Authorize both operations against current membership and retain an audit event. Cache keys include tenant and release; private previews use fresh auth and controlled cache headers. Previously delivered assets cannot be retracted. Deletion must consider active releases, backups, legal retention and custom domains.

[R2 standard pricing](https://developers.cloudflare.com/r2/pricing/) currently lists $0.015/GB-month, $4.50/million Class A operations and $0.36/million Class B operations, with direct Internet egress free. Requests, rounding, workers, transformations and other services still cost money. Allocate service minimums across realistic paying users; do not make every tenant's economics depend on the platform free tier.

### Later release: generated dynamic applications

Use an explicitly isolated user-code platform, such as Workers for Platforms, with separate scripts/bindings/secrets and bounded outbound access. Enforce CPU, invocation, storage, network and spend ceilings per tenant. Provision per-site data access; never share a service-role credential with generated code. Add SSRF protection, build dependency policy, abuse response, deploy approval and tested rollback before launch.

[Workers for Platforms pricing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing/) lists a $25 monthly base including usage allowances; compute, scripts and request overages are separately metered. [Custom limits documentation](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/custom-limits/) is the implementation reference. This is a proposed later architecture, not installed hosting. Static plans above do not promise arbitrary full-stack hosting.

## 6. Gates before publishing prices or activating integrations

1. Obtain owner-approved provider spend cap and actual merchant approval; no existing authorization for paid API calls is inferred from this document.
2. Pin exact library commits/models, record licenses and commercial terms; benchmark representative book/deck/site fixtures, including failures and revisions.
3. Measure accepted-output cost at p50/p95/max, retry rate and render latency. Recalculate tier contribution at full credit redemption, twice-normal failures, rollover concentration and affiliate mix.
4. Implement and verify atomic credits/reservations, real usage ingestion, cancellation/refunds, webhook idempotency, chargebacks and entitlement expiry. Keep prices explicitly proposed until then.
5. Verify tenant separation, domain ownership, builds, release/rollback, abuse caps and billing alerts against real hosting. Never call this ready solely because a plan card exists.
6. Run an invitation pilot with a hard platform cash cap. Expand only after quality, support load and realized costs support the proposed offer.
