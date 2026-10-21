# AI activation at launch (prepared 2026-10-21, not activated)

## State on 2026-10-21 (production `rklojnmmsmhwnkbzuidp`, Vercel project `makeborne`)
- Every row in `makeborne_private.live_provider_limits` is `enabled = false` with `daily_limit_microusd = 0`: `global`, `anthropic`, `openai`, `deepseek`, `qwen_hosted`, `self_hosted`, `media_worker`. AI building and AI images are therefore off for everyone.
- `MAKEBORNE_IMAGE_MODELS=gpt-image-2.5-flare,gpt-image-2.5-sunburst` was added to Vercel **Production** on 2026-10-21, by Kerim's decision (`gpt-image-2` dropped).
  - It takes effect only on the next production deployment.
  - Even then it is inert while the `openai` and `global` limits are disabled.
  - Image routing and its spend controls were qualified locally (`docs/release-review/image-routing-qualification-20261021.md`).
- `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are already present in Production (names checked only).

## Why the daily caps stay (owner asked about "no limit")
Customers pay for their own usage. Every build and image reserves credits from that customer's balance before the provider call, and settles at actual cost. So no single customer can spend beyond their credits.

The provider daily caps are a different control: a circuit breaker on Makeborne's own provider bill. They cover what credits do not:
- a bug that loops calls;
- trial or free-credit abuse;
- payments later refunded or charged back;
- compromised accounts;
- provider price changes.

The schema has no "unlimited" value (`0` = off). Set the caps **high enough that normal paid usage never reaches them**, and raise them as paid volume grows.

## Launch procedure (owner approval required at the time; do not run early)
Run these only as part of the launch, together with checkout activation. Then customers can buy credits for what they use.

1. **Pick the caps.** Size them from the expected paid usage: cap ≈ 2–3 × expected daily provider cost. A Medium website build costs about $1.00 in provider cost (design-quality eval). Images cost about $0.011 each at medium (GPT Image 2.5).

   Suggested starting point, to be adjusted by Kerim:

   | scope | daily cap | meaning |
   |---|---|---|
   | `anthropic` | $100 (100,000,000 microusd) | about 100 Medium builds a day |
   | `openai` | $15 (15,000,000) | about 1,300 images a day |
   | `global` | $115 (115,000,000) | the sum, so neither scope can be starved by the other |

2. **Set the caps** in one transaction, against production only after a fresh backup check:
   ```sql
   begin;
   update makeborne_private.live_provider_limits set daily_limit_microusd = 100000000, enabled = true where scope = 'anthropic';
   update makeborne_private.live_provider_limits set daily_limit_microusd =  15000000, enabled = true where scope = 'openai';
   update makeborne_private.live_provider_limits set daily_limit_microusd = 115000000, enabled = true where scope = 'global';
   select scope, enabled, emergency_stop, daily_limit_microusd from makeborne_private.live_provider_limits where scope in ('global','anthropic','openai');
   commit;
   ```
   Leave `deepseek`, `qwen_hosted`, `self_hosted` and `media_worker` disabled.

3. **Deploy.** Make sure the deployed code includes image routing (main `70a1d91` or later), and redeploy production so `MAKEBORNE_IMAGE_MODELS` is read.

4. **Verify on the live site** with one owner or test account: one Medium build that requests one text image.
   - Check the receipt shows the routed model and its cost.
   - Check `makeborne_provider_spend_status('openai')` and `('anthropic')` reflect the spend.
   - Check that credits were charged to a non-exempt account.

5. **Monitor.** Watch for emergency stops (`emergency_stop = true`, error `MB423`) and daily limit refusals (`MB402`), and raise the caps when legitimate paid usage approaches 80% of a cap.

## Rollback
- Run `update makeborne_private.live_provider_limits set enabled = false where scope in ('global','anthropic','openai');`. This stops all new AI calls immediately; in-flight calls settle normally.
- Remove `MAKEBORNE_IMAGE_MODELS` from Vercel Production and redeploy to turn images off while keeping building on.
