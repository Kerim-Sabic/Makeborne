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
