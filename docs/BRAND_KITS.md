# Brand kits

A brand kit is a logo, five colour roles (main, second, highlight, background, text), a heading and body font from the curated library, a tone of voice, a tagline, and words to use and to avoid.

- **Your brand** (`client_id` null) applies to projects without a client and gives outreach drafts the sender's voice.
- **Client kits** apply only to that client's projects. A client project never falls back to the agency's own brand.

## Where a kit is used

| Place | How |
| --- | --- |
| Website builder and planner | A `<brand_kit>` block in the project context: exact hex tokens, library fonts, voice. The logo is stored once as a project asset at `/images/brand-logo.webp`, and the builder is told to use that exact file. |
| Presentations and books | A `<brand_kit>` block with a complete 7-colour `set_theme` palette derived from the kit, plus the nearest font pairing. |
| Outreach drafts (follow-ups and personalised emails) | A `<sender_brand>` block with the workspace kit's tone and words. |
| Click-to-edit | The kit's colours appear as one-click swatches under Text colour and Background. |

Kit text is bounded, cannot contain `<` or `>`, and is presented to the model as brand facts, not instructions. Stored kits are re-validated on every read; anything invalid is ignored.

## Import from a website

`POST /api/cloud/workspaces/[ws]/brand-kits/import` builds a draft kit from a public site. It uses no AI and saves nothing.

- **Fetching:** reads the page, up to 3 same-site stylesheets and the first usable logo candidate. Every request goes through the research guard rails: public addresses only, pinned DNS, re-checked redirects, size and time limits.
- **Colours:** weighted by where they are used. Root and body rules, `--brand`-style variables, `theme-color` and buttons count most; pale tints and rarely used colours are ignored.
- **Fonts:** mapped onto the library with a closest-match table. The owner sees a note when the site's own font isn't in the library.
- **Logo candidates,** in order: the JSON-LD `logo`, a header `<img>` named logo, an inline logo `<svg>`, then the apple-touch-icon.
- **SVG safety:** an SVG is rasterised only when it references nothing outside itself. External `href`, `url()`, entities, scripts and event handlers are all refused.

Every logo is re-encoded with sharp to a PNG or WebP of at most 512 px and 300 KB. This applies to uploads too, server-side on save.

## Data

Migration `20261014190000_brand_kits.sql`:

- **Table:** `public.brand_kits` with one row per (workspace, client), enforced by `unique nulls not distinct`.
- **Cascades:** the composite foreign key to `clients(id, workspace_id)` cascades, so a kit can only belong to a client of the same workspace.
- **Size:** the kit JSON is capped at 450 KB.
- **Access:** workspace members read. Only the server (service_role) writes, after checking that the caller is an owner or editor.

Until the migration is applied, the panels say brand kits are being set up, and every generator behaves as before.

## Checks

- `node src/lib/brand/check-brand-kits.cjs`: 11 offline groups covering the schema, prompt blocks, palette validity, extraction, SVG safety, logo re-encoding, guarded import and wiring.
- `supabase/check-brand-kits.sql`: one rolled-back transaction on an isolated local stack. It covers shape, one kit per owner, the upsert, cross-workspace refusal, size checks, RLS and cascade.
- `work/click-to-edit-20261014/brand-kits-ui.cjs`: a local browser journey with mocked kit APIs.

## Release

1. Rehearse and apply `20261014190000_brand_kits.sql` through the reviewed release process. The migration is additive.
2. No new secrets or Worker changes are needed.
3. The `publication-controller` does not read kits.
