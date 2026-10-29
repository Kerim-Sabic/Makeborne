# CRM and lead research: audit, gap analysis and plan (25 October 2026)

Owner request (verbatim): "make sure crm is best possible and research of clients and leads in smartest and best possible".

This is a **separate track** from tonight's minimum launch (`release/minimum-launch-20261025`, owned by Codex). Nothing here touches that candidate. The work is on `feature/crm-research` in the worktree `.claude/worktrees/crm-research`, cut from `feature/agency-workflow` c455a66, which is main plus the agency stages: research, knowledge and ingest. Every new capability sits behind `MAKEBORNE_CRM_RESEARCH=on`, which is off by default and set nowhere. There were no paid AI calls.

**Ownership check.** I read the last 25 entries of `docs/AGENT_HANDOFF.md`:
- Codex owns mail (Gmail and Outlook), Connect and connectors, the publishing controller, GitHub, billing and credits, and the minimum launch.
- Codex released its Lead-finder copy claim on 14 October.
- No entry claims `src/lib/leads/*`, `account-clients.tsx` or the CRM routes since then.
- The research, knowledge and ingest code is Claude's (agency stages 2–4).

So this track edits:
- Claude's own agency code;
- new files;
- one or two mount lines in `account-clients.tsx` and `lead-finder.tsx`.

It does **not** edit:
- mail code (`src/lib/mail/*`, `components/mail/*`);
- the credit-charging Lead-finder route (`leads/find/route.ts`);
- the CRM write-protocol triggers.

The integration points for those are listed in §6.

## 1. What exists today (origin/main de7e657 + agency branch c455a66)

| Area | What exists | Where |
|---|---|---|
| Client record | Fields: name, company, email, website, notes, `tags[]` (≤12), `deal_value`/`deal_currency`, `lead_source`, `lead_profile` (social research + AI insight) and the `outreach` jsonb. Optimistic CAS on `updated_at` (409 `REVISION_CONFLICT`). The CRM protocol header is required. | `clients` (foundation + `20261013250000_crm_lead_profile`), `clients/[clientId]/route.ts`, `src/lib/cloud/contracts.ts` |
| Pipeline | Stages: Lead → Contacted → Conversation → Proposal → Won/Lost, stored in `outreach.stage` and validated by a trigger. There is a kanban board with drag and drop or "Move…", value per column, and rollback. Stage moves go through PATCH with CAS. | `client-board.tsx`, `client-outreach.ts`, `20261011190000_crm_transition.sql`, `20261011200000_crm_write_freeze.sql` |
| Next step | **Date only**: `outreach.nextFollowUp`. Buckets are overdue, today, upcoming and unscheduled. Quick "contacted (+3 d)" and "snooze". | `client-followups.ts`, `client-quick-actions.ts` |
| Activity | `outreach.activity[]` (≤300 entries, append-only, plain text). Written by the panels, by sent mail, by synced replies and by enquiry conversion. Reviews, projects, research and knowledge are **not** in it. | `client-outreach.ts`, `mail/engine.ts:53` |
| Search and filter | Substring search on name, company and email; stage filter; follow-up buckets; tag chips; Ctrl+K palette. **No saved views.** | `makeborne_client_directory`, `account-clients.tsx` |
| Import and export | CSV in (≤500 rows, deduplicated only inside the file) and CSV out (≤5000 rows). | `src/lib/client-csv.ts` |
| Lead score | Computed in the browser and not stored: stage + followers + deal value + "researched" + has email. Nothing about the prospect's website. | `src/lib/leads.ts:39` |
| Lead finder | OpenStreetMap: Nominatim, then Overpass, with ~36 categories. Paste a list of ≤40 links. Public-page enrichment: emails (incl. Cloudflare-protected ones), socials, contact page. Ranked by one AI ranking call. **The whole route needs AI chat enabled and holds credits** (0.2 credits per delivered lead). Creator mode and "like" mode return 503 because web search is refused. **Found leads are not stored.** Duplicates against the CRM are matched on host, email, handle and name. | `src/lib/leads/*`, `leads/find/route.ts` |
| Lead → client | Done in the browser, in three requests: create, PATCH outreach, PATCH lead profile. Notes are generated text. Nothing is cited or proposed. | `lead-finder.tsx:102-131` |
| Website audit | `auditSite` measures 13 signals: https, viewport, CTA, form, tap-to-call, © year, legacy markup, h1, meta description, alt text, thin text, heavy page, platform. It is used by "Redesign their website" and by the redesign follow-up draft. **It does not read robots.txt, has no citations, no score, and is not used to rank leads.** | `leads/redesign.ts`, `leads/redesign-server.ts` |
| Enquiries | Site form → `site_enquiries` → "Add to clients" (deduplicated by email, idempotent key). | `crm/enquiry-clients.ts`, `enquiry-leads.tsx` |
| Outreach | Send-only Gmail/Outlook from the user's own mailbox (`ClientEmail`). Sequences, warm-up and the cron exist but are **off** (`MAKEBORNE_MAIL_AUTOMATION_ENABLED`). AI follow-up drafts need chat. **No suppression or do-not-contact list, and no unsubscribe.** | `src/lib/mail/*` (Codex) |
| Reviews and portal | Review links with an approve or request-changes decision, which moves a project's `delivery_stage`. Client portal. | `client-review-*`, `client-portal-*` |
| Understand this client (agency, off) | A cited brief built from supplied documents, approved knowledge and a bounded public-site read. Honours robots.txt, never reads social networks, refuses private IPs, flags conflicting identities and guards against invented numbers. "Save to client" creates PROPOSED facts; "Use in proposal" and "Create a plan" are also available. Flag `MAKEBORNE_CLIENT_RESEARCH`. | `src/lib/research/*`, `client-research.tsx` |
| Client knowledge (agency, off) | Approved facts with evidence (url + fetched_at + sha256 + quote), conflicts, supersession, revocation and retrieval. Flag `MAKEBORNE_CLIENT_KNOWLEDGE`. | `src/lib/knowledge/*`, `client-knowledge.tsx` |
| Dashboards | Pipeline value per board column and follow-up counts. Site analytics count CRM leads and won deals. | — |

## 2. What best-in-class tools do

All of these come from official pages, accessed 25 Oct 2026.

- **Every open deal has a next action with a due date, and anything overdue or missing is surfaced.**
  - Pipedrive orders deals by next activity and marks them red (overdue), green (today) or yellow (none scheduled). <https://support.pipedrive.com/article/how-are-deals-ordered-in-the-pipeline-view>
  - Close's "Needs attention" flags deals that are past their close date, stalled in a stage, or waiting on a reply. <https://help.close.com/feature-guide/opportunities>
- **Stale-deal warnings per stage.**
  - Pipedrive "rotting in X days" is set per stage, and the timer resets on activity. <https://support.pipedrive.com/en/article/the-rotting-feature>
  - Close recommends saved views of leads that have stayed in one status longer than N days. <https://help.close.com/docs/smart-view-tips-and-suggestions>
- **Enrichment never overwrites what the user typed, and shows provenance.**
  - Attio enriches from the company domain, shows enriched cells in a different colour and never overwrites user values. <https://attio.com/help/reference/managing-your-data/enriched-data>
  - HubSpot fills only blank properties. <https://knowledge.hubspot.com/records/enrich-your-contact-and-company-data>
- **AI research on the prospect's own site, with confidence and sources.**
  - Attio's Web agent shows confidence dots and its web sources, and costs 10 credits per record. <https://attio.com/help/reference/attio-ai/ai-attributes>
  - Clay's Claygent answers questions such as "does this dentist offer Invisalign" from the site. It does not document citations. <https://university.clay.com/lessons/enriching-with-claygent>
- **Duplicates matched on domain, name and phone, reviewed before merging, with a "not a duplicate" option.**
  - HubSpot matches on domain, name, country and phone; that feature is on paid tiers. <https://knowledge.hubspot.com/records/manage-duplicate-records>
  - folk has a Duplicates view with the reason and "Don't merge". <https://help.folk.app/en/articles/5007403-clean-manage-duplicates>
  - Pipedrive's Prospector warns when an organization already exists. <https://support.pipedrive.com/en/article/prospector>
- **A website or local-presence audit as the outreach hook.**
  - BrightLocal's Local Search Audit benchmarks a business against the top 10 in its category. <https://help.brightlocal.com/hc/en-us/articles/360025410354-What-is-Local-Search-Audit>
  - SEOptimer offers white-label audits. Its page returned 403, so this is not verified.
  - Readdy, Makeborne's closest rival according to `docs/market/makeborne-vs-competitors-2026-10-23.md`, sells a Maps finder, a demo per prospect and outreach, with **no suppression list**.
- **A transparent fit score: a points model whose signals are visible.**
  - Apollo shows the signals behind a score on hover. <https://knowledge.apollo.io/hc/en-us/articles/27155177775885-How-to-Prospect-in-Apollo>
  - HubSpot separates fit from engagement. <https://knowledge.hubspot.com/scoring/understand-the-lead-scoring-tool>
- **Saved views.**
  - Close Smart Views can be private or shared. <https://help.close.com/docs/search-and-smart-views>
  - Attio has per-list table and kanban views. <https://attio.com/help/reference/attio-101/attios-data-model/understanding-lists>
- **Sequences stop on a reply, send in business hours, and have sending caps and warm-up.**
  - Close: <https://help.close.com/docs/workflows>
  - Apollo, with 50 a day per mailbox, gaps between sends, and held rather than dropped messages: <https://knowledge.apollo.io/hc/en-us/articles/4409233349005-Configure-Email-Sending-Limits>
- **Compliance.**
  - The ICO's B2B guidance:
    - a named business email is personal data;
    - sole traders are individuals;
    - every message must identify the sender and offer an opt-out;
    - the right to object is absolute, so keep a **suppression list** rather than deleting the person;
    - privacy information must be given within one month when the data was collected from elsewhere.

    <https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/>
  - EDPB Guidelines 1/2024 on legitimate interest require a balancing test. <https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202401_legitimateinterest_en.pdf>
  - robots.txt follows RFC 9309. <https://www.rfc-editor.org/rfc/rfc9309.html>
  - Nominatim usage policy: at most 1 request per second, and no systematic bulk downloads. <https://operations.osmfoundation.org/policies/nominatim/>

## 3. Gaps that matter for Makeborne's buyer

Makeborne's buyer is a freelancer or small agency selling websites, books and decks to local businesses.

| # | Gap | Who has it | Impact |
|---|---|---|---|
| G1 | A lead's **current website is not judged** when ranking. The existing audit is not cited, does not honour robots.txt, has no score, and is used only after the lead becomes a client. | BrightLocal, SEOptimer, Readdy (demo), Claygent | The core question for a website seller ("who needs me most?") goes unanswered. |
| G2 | **Lead → client carries no reusable facts.** Notes are free text; nothing cited or proposed. | Attio/HubSpot enrichment with provenance | Facts are retyped or lost. Knowledge and research can't use them. |
| G3 | **No duplicate detection** across clients (domain, phone, email, name). There is only the finder's skip list and per-file CSV dedupe. | HubSpot, folk, Pipedrive | Double outreach to the same business looks unprofessional and is a GDPR risk. |
| G4 | **No "needs attention" or stale-deal view.** Open deals with no follow-up date, or sitting in a stage for weeks, are invisible. | Pipedrive, Close | Deals die quietly. |
| G5 | **The next step has a date but no action.** | Pipedrive, HubSpot, Close | "Follow up 3 Nov" without "send revised quote" isn't actionable. |
| G6 | **No unified activity timeline** covering emails, reviews, projects, research and facts. | HubSpot, Pipedrive, Attio | You can't see the whole relationship. |
| G7 | **No suppression or do-not-contact list.** | ICO guidance, Apollo, folk | Compliance gap for outreach. Readdy lacks it too, so having one is a differentiator. |
| G8 | **Honest personalised outreach** needs AI (the Rex draft is off at launch). Nothing deterministic grounds a draft in audit findings and approved facts. | Clay/Apollo (AI), Close (templates) | Without a draft there is no fast, honest first message. |
| G9 | The **Lead finder is unusable when AI is off**: the route requires chat, although map search, enrichment and the reachability score are deterministic. Found leads are not stored. | Pipedrive Prospector, Apollo | The headline "find leads" feature is dark at launch. |
| G10 | **No saved views.** Search covers name, company and email only. | Close, Attio | Friction at 100+ clients. |
| G11 | Web search for discovering creators and look-alike businesses stays refused. The blocker is the result-token ceiling, see `prices.ts:211`. | Apollo, Clay | Discovery is limited to the map and pasted lists. |

## 4. Prioritised plan (top 8)

"AI" means a model call. Every item below works without it, and the AI parts stay unqualified.

| Rank | Item | User value | Effort | Dependencies | Risks | Paid AI? |
|---|---|---|---|---|---|---|
| 1 | **Website check of a lead's or client's public site** (G1). A deterministic audit on the research reader: robots honoured, guard rails, budgets. It adds checks for page weight, response time, structured data, broken navigation links, contact/hours/CTA, and an outdated © year. Each finding cites url + checked-at + a measured value or quote. The result is an opportunity score 0–100 with its reasons; inaccessible sites are listed with the reason. | Ranks prospects by need and gives an honest hook. | M | research `site.ts`/`page.ts` | False positives: wording says "on the page we read", and the response time is a single measurement from our server. | No |
| 2 | **Fit score** that combines the website opportunity, how reachable the business is, the category matching your offer, and "no website at all". A transparent points model. | "Who first?" in one sort. | S | 1 | Over-trust: the reasons are shown. | No (an AI fit read is an optional later seam) |
| 3 | **Lead → client with research** (G2). One server route: duplicate check, idempotent create, tags and source, the stored audit attached, and the cited findings and contact facts proposed as **PROPOSED** knowledge, never approved. | Facts become reusable and reviewable. | M | 1, knowledge flag | Changed client-create semantics: it reuses `makeborne_create_record`. | No |
| 4 | **Duplicate detection** (G3) on normalised domain, phone, email and name, with reasons, "Not a duplicate" (stored), and a duplicate warning before adding a lead. | No double outreach. | S–M | migration | Merging is out of scope (projects, reviews and mail would have to move): suggest only. | No |
| 5 | **Needs attention and stalled deals** (G4/G5). Overdue, no next step, stalled N days per stage (computed from the activity log), and a next-step text with CAS. | Deals don't die quietly. | S | migration (next step) | Stage age is approximate when the activity history is missing. | No |
| 6 | **Suppression list** (G7). Do-not-contact by email or domain. It is checked by the lead check, add-as-client, drafts and duplicates. Mail-send enforcement is a Codex integration. | Compliance, and trust. | S | migration; Codex for the send path | Until Codex wires the send path, the manual send is not blocked (the draft refuses). | No |
| 7 | **Unified timeline** (G6): outreach activity, emails, reviews, projects, research briefs, proposed and approved facts, and website checks. Read-only, under RLS. | The whole relationship in one place. | M | none | Table drift: each source is optional. | No |
| 8 | **Honest opening email** (G8). Deterministic, built only from cited audit findings and approved facts. It includes the sender's identity and an opt-out line, is refused for suppressed contacts, and is copied into the existing send-only flow by the person. An optional "polish" AI step uses a fake, stays unqualified, and has a cost plan. | A fast, true first message. | S (+M for AI) | 1, 6 | Templated tone: the person edits it. | AI polish is optional; plan in §7 |

Next, after these 8:
- (9) A no-AI Lead-finder path (G9). This changes the credit-charging route Codex owns, so it is listed in §6.
- (10) Saved views (G10), stored per user in a small table.
- (11) Qualified web search (G11), see §7.
- (12) Merging duplicates.
- (13) A local benchmark: score versus the top N in the same category and city, from audits already run.

## 5. What was built in Phase B

Built: plan items 1–8, except the item 8 AI polish (faked and unqualified, as planned). Items 9–13 are not built. Details are in §8.

## 6. Integration points for Codex (not edited here)

- **Mail send path** (`src/lib/mail/engine.ts` `sendEmail`, and `/clients/[id]/mail` POST): before sending, call `isSuppressed(rpc, workspaceId, email)`, which reads `crm_suppressions`. Refuse with 409 `CONTACT_SUPPRESSED`. Sequences and enrollments should do the same at enroll time and at every step. Add an opt-out footer to sequence templates.
- **Lead-finder route** (`leads/find/route.ts`). Proposal: when `chatEnabled()` is false, still run `gatherLeads` (map or list), skip `rankLeads`, and order by `fitScore` (§4 item 2). The credit policy decides whether delivered leads still cost 0.2 credits each without AI. **This is an owner pricing decision.** OSM usage policy also applies: before volume, move to a self-hosted Nominatim/Overpass or a paid OSM provider.
- **CRM write protocol.** The next-step text lives in a new table, so the `outreach` validator is unchanged. If Codex later folds it into `outreach`, the table can be migrated.

## 7. What paid AI or qualification would unlock (not done; no allowance on this track)

- **Web search** (`assertWebSearchTool` still refuses). Unlocks creator discovery, look-alike businesses and "find the website of a business with none on OSM".
  - The blocker is a billable **result-token ceiling**, not money. The qualification plan is in `client-research-search-qualification-20261024.md`.
  - Estimate once solvable: $0.60–0.85 per qualification run, cap $2.
- **Outreach polish** (`polishDraft` seam, faked here). One short call per draft on a small model: input ≈ 1.5k tokens (facts + findings + draft), output ≈ 250 tokens.
  - Qualification: 20 fixture prospects, with checks for invented claims (the knowledge `checkCopyClaims` runs on the output), tone and opt-out preserved. That is ≈ 40 calls, under $0.50 expected, cap $1.
- **AI fit reasoning** ("does this business sell what my offer helps with?"). Reuse the existing `rankLeads` haiku call, with the audit findings added as material.
  - Qualification: 3 fixture sets × 25 leads, compared with a person's ranking. ≈ $0.30, cap $1.
- **Assisted research brief.** Already qualified on the agency branch (PASS); the flags remain off.

## 8. Built on `feature/crm-research` (Phase B)

The work is local only: nothing is pushed, merged or deployed. The flag `MAKEBORNE_CRM_RESEARCH=on` is off and set nowhere; every new route answers 404 `CRM_RESEARCH_DISABLED` before reading anything, and every new panel renders nothing. Spend: 0 AI, 0 cloud.

**Commits:**
- `74936d2`: migration and SQL suite.
- `7f39816`: library, routes and offline harness.
- `984ee33`: UI and mounted browser check.
- A docs and handoff commit.

### Migration `20261025300000_crm_research.sql`

Additive only. It changes no existing object, and leaves the CRM write-protocol triggers untouched.

- **`crm_site_checks`** stores the result of each website check.
  - A prospect check (no client yet) expires in at most 31 days. A check attached to a client is kept.
  - Only `client_id` and `expires_at` can be updated (column grant), and only once, to attach the check.
- **`crm_next_steps`** holds the next-step text. `makeborne_crm_next_step_set` does a compare-and-set on `revision`, runs as the caller under RLS, and raises PT409 when the revision is stale.
- **`crm_suppressions`** is the do-not-contact list: normalised lowercase email or domain, unique per workspace.
- **`crm_duplicate_dismissals`** records "not the same business" for an ordered pair of clients in the same workspace.
- **Access rules:**
  - Members read their workspace's rows; owners and editors (`can_edit`) write them, and only as themselves (`created_by`/`updated_by = auth.uid()`).
  - Anon has no access. Composite foreign keys keep every row inside its workspace.
  - Deleting a client cascades to its checks, next step and dismissals.
- **Retention:** `makeborne_crm_purge_expired_checks()` is service-role only. Scheduling it is an ops decision for Codex.
- **Where it was applied:** the local isolated stack only (`supabase_db_makeborne-release-auth`, 127.0.0.1:55438). A rolled-back dry run came first and left the table absent; the migration was then applied in its own transaction. There was no `db push` and no cloud project was touched.

### Library (`src/lib/crm-research/`)

- **`site-check.ts`** checks one site with the research reader (`readClientSite`). That reader brings the guard rails, robots.txt handling, no social networks or sign-in pages, and per-check budgets (4 pages, 20 s, 600 KB per page). Up to 5 same-site links on the home page are then checked with a 64 KB cap; a "not found" answer counts as a broken link.
  - **Findings:** https, phone layout, clear next step, no contact details, slow (one timed download, labelled as such), broken links, © year, legacy markup, enquiry form, tap-to-call, heavy page, structured data, opening hours, headline, search description, alt text, thin text.
  - **Evidence:** each finding cites the URL, the time it was checked, the page's sha256, and the exact page line or measurement.
  - **Conservative rules:** "no contact" and "no hours" are never claimed if anything that looks like contact details or opening hours appears on a page that was read.
  - **Unreadable or missing sites:** an unreadable site has no score, only the reason. When no website is listed, the check says so and asks the person to confirm.
- **`score.ts`** holds the scoring.
  - The opportunity score is a visible points table, capped at 100.
  - The fit score combines website opportunity (×0.5), "no website" (+40), public email (+15), public phone (+8), a category you serve (+15), and none of those (−10).
  - Do-not-contact and "already a client" are hard stops.
- **`match.ts`** finds duplicates and checks do-not-contact.
  - Duplicates match on domain (ignoring `www` and the scheme; shared hosts such as wixsite and social sites don't count), email, a non-free email domain, phone (last 8 digits, including "Phone:" lines in notes) and name (legal suffixes and accents ignored).
  - Pairs are bucketed by these keys rather than compared all against all.
  - The do-not-contact list covers single emails, whole domains and subdomains.
- **`pipeline.ts`** flags deals that need attention:
  - **overdue:** the follow-up date has passed;
  - **no next step:** an open deal has no follow-up date;
  - **stalled:** the deal has been in its stage longer than the limit (Lead 21 days, Contacted 10, Conversation 14, Proposal 10). Stage age comes from the `Stage: A → B` entries in the activity log; a logged contact resets the clock.
- **`timeline.ts`** merges outreach activity, emails, review links and decisions, projects, research briefs, facts (suggested and approved), website checks and the next step.
- **`draft.ts`** writes the honest first email.
  - It uses up to 3 measured findings, phrased as "when I looked at X on date", plus approved facts only.
  - It includes the sender's identity and a fixed opt-out line, and it is refused for anyone on the do-not-contact list.
  - `polishDraft` is a model seam that is unqualified, so it is refused. With a test port, a rewrite is rejected if it adds numbers, years, prices, emails, phone numbers or URLs, or if it drops the opt-out line.
- **`facts.ts`** turns a check into PROPOSED knowledge only (`contact.phone`, `contact.email`, `address`, `opening_hours.listed`, `website.issue.<id>`). Each proposal carries url evidence: fetched_at, sha256 and, where the value appears on the page, the exact line.
- **`server.ts`** has the reads and writes under RLS, plus:
  - `addProspect`: checks do-not-contact first (409 `CONTACT_SUPPRESSED`), then duplicates (409 `POSSIBLE_DUPLICATE` with the matches, unless the person confirms). It then creates the client idempotently with `makeborne_create_record` and a request key, sets the outreach note, follow-up, lead source and tag, and attaches the check. Facts are proposed through `makeborne_knowledge_propose`, with the person as actor; this happens only when `MAKEBORNE_CLIENT_KNOWLEDGE=on` and stops if the person's permission changes.
  - A limit of one check at a time per person and 4 per server.

### Routes

Both routes check the flag first. Writes are for owners and editors only; reviewers get 403.

- **`GET/POST /api/cloud/workspaces/[ws]/crm`**
  - GET returns needs-attention, duplicates and do-not-contact. `?probe=1` only answers whether the feature is on for this person, without reading workspace data.
  - POST actions: `check`, `add`, `dismiss_duplicate`, `suppress`, `unsuppress`, `delete_check`.
- **`GET/POST /api/cloud/workspaces/[ws]/clients/[client]/crm`**
  - GET returns the client's check, timeline, attention items, next step, duplicates and do-not-contact state.
  - POST actions: `check`, `next_step` (compare-and-set), `draft` (returns `sent:false`; nothing is sent), `propose`.

### UI

- **`crm/crm-insights.tsx`**, above the client list (one mount line in `account-clients.tsx`). It has four tabs:
  - Needs attention;
  - Check a business, which runs a check and offers "Add as client with this check" with duplicate confirmation;
  - Possible duplicates, with "Not the same";
  - Do not contact.
- **`crm/client-crm.tsx`**, on the client's Outreach tab (one mount line). It shows:
  - the next step;
  - the website check, with "Suggest facts from this check";
  - the first-email draft (Copy, and "Open the Email tab to send it");
  - duplicate and do-not-contact banners;
  - the timeline.
- **`crm/lead-website-check.tsx`**: "Check website", then "Add with this check", under each Lead finder result. `lead-finder.tsx` gains an optional `check` slot and its import, and nothing else.
- Customer copy names no provider or model.

### Tests

- **Offline harness** `src/lib/crm-research/check-crm-research.cjs`: 13/13. It uses a local 127.0.0.1 fixture server; no public network is used.
  - Good, outdated, slow, no-https, robots-disallow, private-IP-redirect, missing, social and no-website sites. The real guard refuses 127.0.0.1, 10.x, localhost, ::1, credentials and non-standard ports.
  - Fit determinism, duplicates, do-not-contact, attention and stall, timeline.
  - The draft: no invented figures; polish is refused, and inventive or opt-out-dropping rewrites are rejected.
  - Proposals carry citations.
  - Lead → client: duplicate and do-not-contact refusals, idempotent replay, check attached, facts proposed and never approved, knowledge off, permission change.
  - Boundaries.
- **SQL** `supabase/check-crm-research.sql`, sections A–G PASS:
  - A, B: RLS for checks and attach.
  - C: next-step compare-and-set.
  - D: do-not-contact and dismissals.
  - E: cascade and purge.
  - F: real knowledge entry point.
  - G: real CRM write-protocol triggers.

  Regressions on the migrated schema all pass: `check-client-knowledge`, `check-client-research`, `check-client-directory`, `check-agency-operations`, `check-brand-kits`.
- **Mounted browser check** `scripts/check-crm-research-browser.cjs`: 9/9 in Chromium, Firefox and WebKit. It covers:
  - off renders nothing;
  - attention and prospect check, with duplicate confirmation that reuses the same request key;
  - duplicates and do-not-contact;
  - reviewer read-only;
  - next-step conflict then save;
  - the draft (copy only) and fact suggestions;
  - do-not-contact blocks the draft;
  - the Lead finder row check;
  - 375 px.

  Screenshots are in the session scratchpad `crm-research/`.
- **Existing checks:** `check-lead-finder` 22/22 (its harness stubs the new row check like its other imports), plus `check-connections-browser`, `check-trust-copy-browser` and `check-command-palette-browser`.
- **Build:** `npm test` 196/196, `tsc --noEmit` clean, full `eslint .` clean, `next build --webpack` exit 0 (both routes built).

### Not done, and needs owner or Codex

- **Mail send enforcement** of the do-not-contact list. See §6.
- **A no-AI Lead finder.** This is a pricing decision and a Codex route; see §6.
- **Saved views.**
- **Merging duplicates.**
- **Benchmarking against local competitors.**
- **A concurrent two-session race** for the next-step compare-and-set. Postgres row locking with `where revision = expected` gives the guarantee, but no two-connection test was written.
- **A real signed-in end-to-end run** against a local Next server.
- **Scheduling the purge.**
- **Review and decisions:** Codex should review the migration and the two routes' trust boundary. The owner should decide on flag activation and the AI polish qualification (§7).
