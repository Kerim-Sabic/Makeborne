# Golden set: 24 frozen briefs

The fixed inputs every eval round generates from (`docs/execution/QUALITY_BAR.md` §1): **20 websites** (two for each of the ten industry directions in `src/lib/builder/prompt.ts`, INDUSTRY DIRECTION), **2 decks** and **2 books**. Frozen on 2026-10-18. Generation effort for the set is **Medium**.

## Files

- `<id>.json`, one per brief:

  | Field | Meaning |
  |---|---|
  | `id` | `wNN-<direction>-<name>` (website), `dNN-…` (deck), `bNN-…` (book) |
  | `order` | run priority 1–24 (the runner and the budget cap go in this order) |
  | `format` | `website`, `presentation` or `book` |
  | `direction` | one of `restaurant`, `saas`, `professional`, `creator`, `ecommerce`, `wellness`, `trades`, `property`, `events`, `civic`; decks and books carry the closest one |
  | `title` | the project title |
  | `shared` | `true` for the 8 competitor briefs (`../competitors/README.md`) |
  | `brief` | **the exact text** sent as the project brief and the build message (400–1200 characters) |
  | `source` | `{type: real \| persona, path, adaptation}`: where the brief came from and what was changed, and why |
  | `persona` | the Helix persona file the voice comes from (`C:/Helix/Knowledge/Customers/`), or `null` |
  | `mustHave` | 3–6 concrete, checkable requirements that the brief itself states |
  | `notes` | prior outputs usable for regression, calendar checks, caveats |

- `index.json`: `{schemaVersion, frozenAt, count, effort, order, sha256, directions, shared}`. `sha256` is the SHA-256 of each brief file's exact bytes (UTF-8, LF line endings, trailing newline). Runs record these hashes, so a result always names the exact brief it came from.
- `.gitattributes` keeps LF line endings on Windows checkouts (`core.autocrlf=true` would otherwise rewrite the bytes and break the hashes).

## How the set was built

1. **Real briefs first.** Fourteen come from briefs already used in this repo or in the local studio database: the product-qualification cases (`scripts/qualify-products.mjs`: Saffron Table, Relay Operations, Mira Objects, The Useful Client Brief), the generation-worker qualification (Good Dog), the 14 October generation-quality fixtures (Ovenbird Bakehouse, Hartwell Rook), the fresh-quality cases (`scripts/fresh-quality-common.mjs`: Keep the Wheels Turning, The Repair Table), the plan-mode seed (Lumen Atelier, `src/lib/builder/check-plan.cjs`, expanded in a persona's voice) and four project briefs from the makeborne-local stack (127.0.0.1:55322, read inside `begin read only … rollback`): Ledgerline, Kafa Tamo, Crux Yard and the Tidewater seed pitch (rewritten in the pitch-deck founder persona's voice). Most have a prior output, named in `notes`, for regression.
2. **Personas for the gaps.** The other ten are written in the voice of a Helix customer persona (`C:/Helix/Knowledge/Customers/`): plain words, the persona's real goals and constraints, concrete supplied details, what visitors should do, and honest limits. Music venues and hotels have no persona; those two are a plausible owner voice (`source.type: persona`, `persona: null`).
3. **Excluded on purpose.** The `work/redesign-quality` briefs (real third-party businesses with personal data), anything that needs Makeborne-only inputs (redesign from a URL, brand kits, approved copy, CRM), and the empty-brief projects in the local database.
4. **Rules applied to every brief.**
   - Makeborne runtime lines are stripped ("image API is unavailable", "Use the approved React/Vite toolchain", "Bundle any permitted local fonts"), so the same text works in Lovable, Bolt, Framer AI and Base44.
   - No style is named unless the client would naturally ask for it. In particular the cream/serif/ivory wording of two original briefs is removed, so the set does not force the house look the diversity metrics (D1–D5) penalise.
   - Honesty constraints are kept or made explicit: unsupplied prices, hours, addresses and numbers stay as marked placeholders; forms that are not connected must not fake success; no invented testimonials, reviews, awards, logos or statistics. Every phone number is fictional: US numbers are in the reserved 555-0100–0199 range, UK numbers in the Ofcom drama ranges, and briefs set where no reserved range exists give an email address only. Email domains use `.example`.
   - Variety: US, UK, Ireland, Belgium, Portugal, Slovenia, Croatia and Bosnia and Herzegovina; solo owners to small firms; loud, dry, warm and formal voices.
5. **Priority order.** The 8 shared website briefs first (orders 1–8), then one deck (9) and one book (10), then websites so all ten directions are covered by order 12, then the rest. If a round has to stop early (budget cap), the most comparable work is already done.

## Freezing rule

A frozen brief is **never edited**, not even for a typo. If a brief has to change, add a **new id** (the next free number, for example `w21-restaurant-…`), add it to `index.json` (order, hash, direction) and leave the old file and its hash untouched, so results generated from the old text stay comparable and traceable. Existing hashes in `index.json` never change.

Check the hashes (every brief file against `index.json`):

```bash
node -e "const fs=require('fs'),c=require('crypto'),d='scripts/eval/briefs/',i=JSON.parse(fs.readFileSync(d+'index.json','utf8'));let bad=0;for(const id of i.order){const raw=fs.readFileSync(d+id+'.json');if(c.createHash('sha256').update(raw).digest('hex')!==i.sha256[id]){bad++;console.log('hash mismatch',id)}}console.log(i.count,'briefs,',bad,'hash mismatches')"
```

## The set

<!-- briefs-table:start -->
_Copied verbatim from the brief files; if this table and a brief file ever differ, the brief file wins._

| Order | id | Format | Direction | Source | Shared |
|---:|---|---|---|---|---|
| 1 | `w01-restaurant-saffron-table` | website | restaurant | real: `scripts/qualify-products.mjs:8` | yes |
| 2 | `w02-saas-relay-operations` | website | saas | real: `scripts/qualify-products.mjs:9` | yes |
| 3 | `w03-professional-hartwell-rook` | website | professional | real: `work/generation-quality-20261014/website/law/fixture.json (.brief)` | yes |
| 4 | `w04-creator-mira-objects` | website | creator | real: `scripts/qualify-products.mjs:10` | yes |
| 5 | `w05-ecommerce-good-dog` | website | ecommerce | real: `infra/generation-worker/run-qualification.mjs:153` | yes |
| 6 | `w06-wellness-laurel-creek-dental` | website | wellness | persona: US dental practice owner | yes |
| 7 | `w07-trades-hollis-heating-plumbing` | website | trades | persona: US home services contractor | yes |
| 8 | `w08-events-low-ceiling` | website | events | persona: owner voice (no persona) | yes |
| 9 | `d01-keep-the-wheels-turning` | presentation | trades | real: `scripts/fresh-quality-common.mjs:18` |  |
| 10 | `b01-useful-client-brief` | book | creator | real: `scripts/qualify-products.mjs:11` |  |
| 11 | `w09-property-lumen-atelier` | website | property | real: `src/lib/builder/check-plan.cjs:14-15` (voice: Small business owner needing a website) |  |
| 12 | `w10-civic-elmwood-pantry` | website | civic | persona: Nonprofit organizer |  |
| 13 | `w11-restaurant-ovenbird-bakehouse` | website | restaurant | real: `work/generation-quality-20261014/website/bakery/fixture.json (.brief)` |  |
| 14 | `w12-saas-ledgerline` | website | saas | real: `makeborne-local public.projects a1a909f3-16ec-45d4-a70f-1b1df7492b62` |  |
| 15 | `w13-professional-fernhill-books-tax` | website | professional | persona: US accountant and bookkeeper |  |
| 16 | `w14-creator-foxed-podcast` | website | creator | persona: Podcaster |  |
| 17 | `w15-ecommerce-kafa-tamo` | website | ecommerce | real: `makeborne-local public.projects 6d14f673-e18c-4010-9e93-85a3aa67dd9b` |  |
| 18 | `w16-wellness-crux-yard` | website | wellness | real: `makeborne-local public.projects ea75bd43-3db7-4d02-a141-e5b311441f97` |  |
| 19 | `w17-trades-saltbush-auto` | website | trades | persona: US auto repair shop owner |  |
| 20 | `w18-property-hisa-burja` | website | property | persona: owner voice (no persona) |  |
| 21 | `w19-events-ridgeline-weddings` | website | events | persona: US wedding vendor |  |
| 22 | `w20-civic-glen-rise-maths-club` | website | civic | persona: Teacher and educator |  |
| 23 | `d02-tidewater-seed-pitch` | presentation | saas | real: `makeborne-local public.projects 146754b7-c201-44ec-bda1-0e9e656c38fa` (voice: Startup founder needing a pitch deck) |  |
| 24 | `b02-repair-table` | book | civic | real: `scripts/fresh-quality-common.mjs:17` |  |
<!-- briefs-table:end -->
