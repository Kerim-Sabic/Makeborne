## Owner decisions confirmed to Codex — 2026-10-13

These supersede the earlier recommendations below:
- D1: no founder checkout at launch; keep it disabled.
- D3: no free trial at launch; keep it disabled.
- D5: plan switching is required for launch. It remains BLOCKED until the provider-supported lifecycle, allowance policy and implementation are verified. Do not silently enable cancel/rebuy as equivalent to seamless switching.
- D6: credit packs are required for launch. They remain BLOCKED until pricing/expiry/support policy and checkout/delivery/replay tests are qualified.
- D7: no self-service refunds; requests go through support. Existing statutory and binding-provider exceptions remain. Audited handling of unspent credits on refunds still needs implementation/policy qualification.
- D8: AI images are required for launch. Owner expects to add the OpenAI key later, possibly tomorrow. No paid call is authorized by that statement. The 2.5 qualification command is blocked until an enforceable cost/output bound exists.
- D2: margin floor not yet confirmed; current 40% enforcement and proposed 50% unchanged.
- D4: founder discount not required for this launch because founder checkout is excluded.

Plan switching, credit packs and images are required unfinished gates, not features approved for silent exclusion. Production payments and deployment remain closed.

---

# Pending billing decisions (gate 3)

Status 2026-10-13. These are owner decisions, not engineering defects. The
review changed no live offer, price, plan or customer copy. Each decision
lists the current behaviour, the conflict found and what must change after
the decision.

## Reconciliation summary

| Topic | Customer copy | Implementation | Status |
| --- | --- | --- | --- |
| Included-credit expiry | Expire at the end of the allocation month, soonest first (`billing/terms`, `billing-workspace.tsx:69`) | `credit_lots` expire at allocation end, plan lots spent first (20261012120000) | Consistent |
| Annual plans | Credits released monthly, not all up front | One allocation per month of the provider period (sandbox annual purchase: 1 allocation) | Consistent |
| Trial credits | "Trial credits do not expire" | Trial lots have no expiry; the free tier is off by default (20261011170000), 50 credits when enabled | Consistent; the trial itself is undecided (D3) |
| Renewal price | Renews at the standard price after the discounted first term | Whop plan configuration, not app code | Unverified until a real renewal is observed (gate 2) |
| Founding reservation | Deferred start (owner requirement) | Not implemented; checkout disabled | Disabled; D1 |
| Credit packs | "Final pricing, expiry and refund terms will be shown before purchase" | `POST /api/billing/topups` returns `503 TOPUPS_NOT_OPEN` | Consistent (closed) |

## Summary

| Item | Recommendation | Can stay disabled at launch? |
| --- | --- | --- |
| D1 Founding offer | Two steps (reservation now, renewal consent at launch) | Yes: founder checkout does not exist and stays off |
| D2 Margin floor | Enforce 50% only together with D4; until then keep 40% | Not applicable (guardrail) |
| D3 Trial | No trial at launch | Yes: off by default |
| D4 Founding discount | 30% monthly, 15% yearly first term | Yes, with D1 |
| D5 Replacement | No plan switching at launch; cancel and rebuy only | Yes: no switch path exists |
| D6 Credit packs | Closed at launch | Yes: route returns 503 |
| D7 Refunds | Keep the current terms; add a support rule for credits | Support policy, needed before any payment |
| D8 Image model | `gpt-image-2.5-sunburst` after a measured qualification | Yes: images off |

## D1. Founding offer

- **Current behaviour:** no founder checkout exists. The CTA is disabled, and the terms say checkout is not accepting payments. The copy describes the owner's intended deferred start.
- **Finding:** Whop documents no pre-order or delayed-start feature. A normal purchase starts the paid period at once (sandbox annual purchase: period 2026-10-12 → 2027-10-12). Full analysis: `docs/FOUNDING_OFFER.md`.
- **Recommendation:** option B. Sell a one-time founding reservation now. At launch, an idempotent activation grants the first term's credits from launch, and the founder starts automatic renewal through a checkout whose free trial covers the prepaid term. Every step is documented. Option A (one checkout, trial extended by a job) gives automatic renewal without a second step, but relies on undocumented `extend`-on-trial behaviour; test it first with the sandbox `founding-probe`.
- **Implications:**
  - B: founders who don't confirm at launch keep their paid term but don't renew. The copy line "Your next payment is due only after that first month or year" must say renewal is confirmed at launch.
  - A: a job failure before launch charges founders the standard price early.
- **Disabled at launch:** yes. Nothing can sell it today.

## D2. AI margin floor

- **Current behaviour:** `enforcedMinAiMargin` 0.40 is enforced. `proposedMinAiMargin` 0.50 is a draft.
- **Figures** (AI cost $0.03 per credit, every credit used, images off):
  - standard plans: 58.5–69.0%;
  - monthly founding: 52.6–55.7%;
  - yearly founding at 30%: 40.8% (Scale), 42.4% (Studio), 44.6% (Create);
  - top-ups: 68.4–75.0%.
- **Recommendation:** adopt 0.50 together with D4's 15% yearly founding discount. That moves yearly founding to 51.2–54.4%, and every offer clears 0.50. Do not adopt 0.50 alone: the live yearly founding offers would fail it.
- **Implications:**
  - The floor ignores payment fees (Whop's processing), hosting and support, so real margins are lower.
  - If gpt-image-2.5 is enabled, credits estimated for images must be reviewed against measured cost.
- **Disabled at launch:** not applicable. It is a guardrail in `check-margins.cjs`.

## D3. Trial

- **Current behaviour:** off (`free_tier_enabled = false`), 50 non-expiring `trial_credits` when enabled.
- **Recommendation:** no trial at launch. Founders and paying customers first; revisit once abuse controls and real cost per run are measured.
- **Implications:** 50 credits cost at most $1.50 of AI per account. Each confirmed email is an account, so without extra signup controls a trial is open to multi-account abuse.
- **Disabled at launch:** yes. Enabling later is one SQL statement (`BILLING_PLAN_CREDITS.md`).

## D4. Founding discount

- **Current behaviour:** `FOUNDING_DISCOUNT_PERCENT = 30` for the first month or year. The draft is 15% for yearly.
- **Recommendation:** 30% off the first month; 15% off the first year (still 32% below twelve standard monthly payments, because yearly already has 20% off).
- **Implications:** about 10 points more AI margin on yearly founders (40.8–44.6% → 51.2–54.4%). Lower headline appeal for yearly.
- **Disabled at launch:** yes, it only applies through D1.

## D5. Subscription replacement (plan change)

- **Current behaviour:**
  - Whop has no plan-change or proration API.
  - The app blocks a second purchase while any membership is active, canceling, past-due or unresolved (PBC01).
  - After a membership ends, a new purchase is a new subscription with its own allowance.
- **Risk:** support immediately cancels and refunds a membership, then the customer rebuys in the same month. The refunded period's unspent included credits stay until their month ends (granted credits are never clawed back). Exposure is at most one month's allowance per case, and only through support action.
- **Recommendation:** no self-serve switching at launch. Upgrades are done by support as "cancel at period end, then buy the new plan when it ends". If an immediate switch is needed, apply D7's credit rule.
- **Disabled at launch:** yes. No switching path exists in the app.

## D6. Credit packs (top-ups)

- **Current behaviour:** the catalog is a preview at 68.4–75.0% margin. `POST /api/billing/topups` returns `503 TOPUPS_NOT_OPEN`.
- **Recommendation:** closed at launch. Before opening, decide the pack expiry (suggested: 12 months) and the refund rule (unused packs refundable within 14 days, used credits not).
- **Disabled at launch:** yes.

## D7. Refunds and support

- **Current behaviour:**
  - The terms say subscription payments are non-refundable except where law or Whop's binding policies require. This is not an absolute claim; it names statutory exceptions.
  - Refunds are support actions in Whop, and the sandbox refund was observed (`whop-evidence-matrix.json`).
  - The app never treats a refunded payment as allocation evidence, but credits already granted are not clawed back.
- **Recommendation:** keep the terms. Add an internal support rule: when refunding a period, also lapse that period's unspent included credits with an audited `adjust` entry. This is an operator SQL function to be built when decided; not built yet.
- **Update 2026-10-20 (branch `feature/billing-refunds-provenance`, not released):** the owner's launch brief sets a voluntary refund policy: a payment is refundable only while none of the credits it supplied were used. Terms `2026-10-20-standard-v7` say so. Refunds reconcile automatically: a refunded period's unused credits are withheld and its creation access revoked (migration `20261020090000`, `docs/BILLING_PLAN_CREDITS.md`). The superseded wording above stays live until that release.
- **Implications:** without the rule, a refunded customer keeps unspent credits until the month ends, but loses creation access when the membership ends.
- **Disabled at launch:** no. Needed before any payment is taken, as a support procedure.

## D8. Image model (owner direction 2026-10-13: use the newest model)

Target: **`gpt-image-2.5-sunburst`** (snapshot 2026-09-08). OpenAI calls it its most capable image model and names it, with `gpt-image-2.5-flare` (fastest, same token rates), as gpt-image-1's replacement.

Current behaviour:
- Images are off unless `OPENAI_API_KEY` and `MAKEBORNE_IMAGE_MODEL` are both set. There is no default model.
- `gpt-image-1` is refused from 2026-10-23.
- `gpt-image-2` has published per-image prices, so it can be bounded.
- The 2.5 models have token rates ($5 text, $8 image input, $30 image output per 1M) but **no published per-image price or output-token count**. The spending gate cannot reserve a maximum for them, so they are refused until measured.

How Sunburst becomes usable, without a default change:
1. Establish a documented maximum billable output for the exact request configuration, or a provider-enforced per-request cost/output limit. A measured sample plus headroom is not a maximum.
2. Review and test reservation and settlement against that enforceable bound, including failure and uncertain usage.
3. Obtain an OpenAI key and explicit approval for the bounded live qualification. No paid call is authorized currently.
4. Review output quality and costs, then explicitly enable the model and provider gate.

The previous qualification script borrowed another model's token count and could exceed its advertised cap. It is now disabled before any network call. Do not populate `MEASURED_IMAGE_OUTPUT_TOKENS` from sample counts to enable the model.

Launch without the qualification: images off. The builder designs with typography, CSS and SVG, and no image controls are shown.
