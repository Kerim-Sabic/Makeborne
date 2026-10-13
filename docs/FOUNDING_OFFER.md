# Founding offer: deferred start

Status 2026-10-13: **DISABLED and not implemented.** No founder checkout exists in code. The buttons are disabled ("Founder checkout being prepared"), and the terms say checkout is not accepting payments. Nothing here changes a live offer.

## Owner requirement

1. Founders pay before launch.
2. They can browse while waiting.
3. Credits start at launch.
4. The first paid month or year starts at launch.
5. Automatic renewal follows at the disclosed standard price.
6. The founding discount applies to the first term only.

The existing copy (`billing/terms`, `founding-plans.tsx`, `billing-workspace.tsx`) describes exactly this. The offer it describes is not purchasable.

## What Whop documents (docs.whop.com, read 2026-10-13)

- **No pre-order, launch-date, delayed-start or scheduled-billing feature.** A waitlist (`release_method: waitlist`) takes card details but charges nothing and grants no membership until approval, so founders would not have paid.
- **`initial_price` is an extra one-off charge**, not a discounted first term. A plan charges `initial_price` plus the first `renewal_price`. During a free trial it charges `initial_price` alone, then `renewal_price` when the trial ends.
- **`trial_period_days`**: no documented maximum. The trial is fixed at purchase, and someone who has already used a trial on that plan is charged full price.
- **`POST /memberships/{id}/extend`** (legacy: `add_free_days`, 1–1095 days) moves the next renewal date forward. The legacy wording scopes trials to "Stripe trial". Nothing documents shortening a period or trial.
- **Pause and resume exist**, but what happens to the period while paused is undocumented, and the docs contradict each other on access. No webhook fires for pause, resume or extend.
- **No plan change, proration or account-credit API.**
- **API versions:** requests without `Api-Version-Date` use the version pinned on the key, which defaults to the latest. The sandbox key returns 400 on list calls unless pinned. The app pins `2025-01-01` on every request; the webhook endpoint must be pinned too (`RELEASE_CHECKLIST.md`).

## Options

**B. Two steps: reservation now, renewal consent at launch (recommended)**

Every step is documented:
1. **Before launch:** the founder buys a one-time "Founding reservation" (Create/Studio/Scale × monthly/yearly) at the founding price. The app records a pending-founder state: browse access, no credits.
2. **At launch:** an idempotent activation job grants the first-term credits, anchored at the launch instant. Yearly reservations get twelve monthly allocations, and included credits expire as usual. The founder is then asked to start automatic renewal through a checkout on a hidden plan with `trial_period_days` equal to the paid term and `renewal_price` at the standard price. Whop charges nothing until the trial ends, at launch + term.
3. **Cancellation:**
   - before launch: a support refund of the one-time payment (refund API, observed working in the sandbox), and the pending state ends;
   - after launch: cancel the trialing membership, and the paid first term remains.

Cost: renewal needs one confirmation from the founder at launch. Founders who don't confirm keep their paid term and are not renewed. The copy must say this: today's "Your next payment is due only after that first month or year" implies automatic renewal without a second step.

New app work:
- a founder reservation record bound to the verified payment;
- the activation job;
- launch-anchored allocations, including a rule that the reservation payment is the evidence for the trial term, so it is never granted twice;
- tests for duplicates, replay and reordering.

**A. One checkout, trial kept ahead of launch by repeated extends**

A hidden plan with `initial_price` = founding price, a short trial and `renewal_price` = standard. A job extends the trial so it never ends before launch + term. This gives automatic renewal with no second step, but relies on behaviour that isn't documented: `extend` on a Whop-billed trial, whether extends add up past 1095 days, and the charge amount and date at trial end. If the job ever stops before launch, Whop charges the standard price early. The sandbox `founding-probe` plan (`docs/release-review/whop-sandbox-probes.json`) exists to test exactly this.

**C. Pause until launch** — not buildable safely: the period behaviour is undocumented.

**D. Buy normally, add free days at launch** — monthly founders would be charged before launch unless extended in advance (the same dependency as A), and the discount would need a promo code.

## Decision needed (narrow)

Pick B (two steps, fully documented, needs founder confirmation at launch) or A (one step, needs the sandbox extend test below to pass first). Until then, founder checkout stays disabled.

## Sandbox evidence to collect (owner purchases, sandbox test cards only)

| Probe | Buy at | Card | Observes |
| --- | --- | --- | --- |
| `founding-probe` (`plan_zv6H9bagoIYQV`) | https://sandbox.whop.com/checkout/plan_zv6H9bagoIYQV | 4242 4242 4242 4242 | Initial $2 with a 1-day trial. Then I call `extend` +2 days on the trialing membership and record whether the trial end moves without a charge, and what is charged when it ends ($3 expected). |

After purchase, run `node scripts/observe-whop-sandbox.mjs` to record state. The extend call is added only once a trialing membership exists.
