# Redesign this lead's website

On a client's page, **Redesign their website** reads their current site and prepares a speculative redesign the agency can build and show them. Reading the site is free: it uses no AI and saves nothing. Building the redesign then uses credits as normal.

## What it reads

`POST /api/cloud/workspaces/[ws]/clients/[clientId]/redesign` reads the client's site. Only owners and editors can use it.

- **Pages:** the home page, plus up to three navigation pages, chosen in this order: services or menu, about, then pricing or contact.
- **Fetching:** every request goes through the research guard rails (public addresses only, pinned DNS, re-checked redirects, size and time limits). Pages that redirect off the site are skipped.
- **Plain http:** when the address has no `https://`, it falls back to `http://`, since old sites often have no certificate. An address that explicitly says `https://` never falls back.
- **Content kept:** headings, paragraphs and list items. It also keeps phone numbers, emails and social links. Address, opening hours and price range come from the site's structured data, when it has any. Navigation, cookie and boilerplate text are dropped.
- **Audit:** plain-English findings, most important first. It checks for:
  - no https;
  - no mobile layout;
  - no clear next step;
  - no enquiry form;
  - no tap-to-call number;
  - an out-of-date copyright year;
  - outdated layout code;
  - no main headline;
  - no search description;
  - images without descriptions;
  - very little text;
  - a heavy page;
  - which site builder it was made with.
- **Brand:** the same extraction as brand-kit import. The owner can save it as the client's brand kit, ticked by default unless the client already has one.

## The brief

`redesignBrief()` writes the brief and keeps it under 7,500 characters, so it also fits the builder's 8,000-character first message. It tells the builder to:

- keep the business's real facts;
- never invent testimonials, prices or numbers;
- use the brand kit;
- build these pages: Home, the pages it read, and Contact with an enquiry form;
- fix the problems the audit found.

Text from the site sits inside `<current_site_content>` and is marked as material, not instructions. Angle brackets are stripped from it, so it can't open or close a tag.

**Create the redesign** opens the normal project setup with the brief and the title "<Name> website redesign" filled in.

## Outreach

The bulk email writer has a new angle, **"Businesses: I redesigned your website"** (campaign `redesign`). For this angle, the email route audits the lead's home page and adds the findings as a delimited `<site_audit>` block. The email may only mention problems listed there.

## Related fix

A project brief longer than 8,000 characters used to fail on its automatic first build. The first message is now shortened, and the full brief is still in the project context.

## Checks

- `node src/lib/leads/check-redesign.cjs` (7 groups).
- `work/click-to-edit-20261014/redesign-ui.cjs`: a local browser test with the APIs faked.

There is no migration and no new secret.

## Quality pass (2026-10-15, after owner feedback that a redesign looked worse than the original)

The causes were constraints that kept the new design too close to the old site, and missing imagery. What changed:

- **Brand as a starting point.** Kits read from an old site are saved with `usage: "guide"`. The builder must keep the logo and main colour recognisable, but builds a modern palette around them and picks the strongest font pairing. Old fonts and neutrals are only hints. Owner kits stay `exact` by default, and the kit editor has a "How should designs use this kit?" choice.
- **Logo placement.** A logo with a solid background, or a small one, is placed only on a matching surface or kept small; otherwise the builder uses a typographic wordmark. The old logo is never pasted onto photos.
- **Their real photos.** The reader collects their photographs:
  - the share image first, then `<img>` tags (largest `srcset` version) and inline background images;
  - logos, icons and payment badges are skipped;
  - each photo is downloaded through the guard (8 MB cap) and kept only if it is at least 640×360.
  
  The brief lists up to 6 in a delimited `<their_photos>` block. On the build, they are downloaded once, resized to at most 2000 px and stored as `/images/photo-N.webp`. The builder is told to use them instead of generating images of the same subjects.
- **Focus and ambition.**
  - The brief now asks for a site dramatically better than the original, a fresh concept, an art-directed first screen, rewritten copy and no reuse of the old layout.
  - It builds one outstanding home page, plus one list page (menu, prices, treatments) only when their content needs it.
  - Site text is labelled as "facts and wording, not a model".

## Live quality runs (2026-10-15, owner-approved, $2.75 total)

Five real builds ran through `runBuilder` with the same context `/api/build` assembles (`work/redesign-quality/build.cjs`), and were rendered with the preview bundler's fonts and assets (`render.cjs`). Two dated small-business sites were used: a dental template site and a family bakery.

What each run taught, and the fix that followed:

- **Logos.**
  - A white icon logo was placed on a light header. Logo tone is now detected (`logoTone`), and icon marks are recognised.
  - A white stamp logo inside a transparent canvas was misjudged. Logos are now trimmed of transparent or blank margins (`trimLogo`) before they are judged and stored.
  - A boxed logo whose box clashes with the brand's background is replaced by a typographic wordmark, decided in code rather than left to the builder.
- **Colours.**
  - A bakery came out navy and corporate blue because a Material Design default blue was read as its brand. Stock framework and social colours are now ignored (unless declared as the `theme-color`).
  - Dark sites are recognised from how their light colour is used (mostly as text).
  - "Starting point" kits are told to keep the site's light or dark character, and to take the palette from their photos and logo when the colours look generic.
- **Wording.** Copy said "from our previous website". The brief now forbids mentioning a previous site, a redesign or content sources, and prefers leaving out an element over showing a placeholder.
- **Page reading.** A staff caption was read as a page. Navigation labels must now be short (at most 28 characters and 4 words, no commas).

Results:
- Medium effort finished in 92–182 s for $0.38–0.66 per build.
- High effort produced a more refined site, but hit the 280 s run limit before calling `finish`. Its files were valid and kept.
- The final runs had no static problems and no horizontal overflow on desktop or phone.
