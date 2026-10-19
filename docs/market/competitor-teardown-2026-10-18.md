# Competitor teardown — how they work, and where Makeborne wins — 18 October 2026

Seventeen products, four research reports (each claim carries a URL in the raw reports under `docs/market/teardown-2026-10-18/`). This file is the synthesis. The 13 October pricing table (`docs/market/competitor-report.html`) is still valid and is not repeated here.

Raw reports:
- `app-builders-lovable-bolt-v0.md` — Lovable, Bolt.new, v0
- `fullstack-base44-replit-emergent.md` — Base44 (Wix), Replit Agent 4, Emergent
- `website-builders-framer-webflow-durable-wix-10web-relume.md` — Framer 3.0, Webflow, Durable, Wix Harmony and Studio 2, Hostinger AI Builder, 10Web, Relume Publish
- `decks-and-books-gamma-canva-beautifulai-pitch-kdp.md` — Gamma 5, Canva AI 2.0, Beautiful.ai, Pitch Agent, Plus AI, Tome, Vellum, Atticus, Reedsy, Designrr, Book Bolt, children's-book generators, KDP rules

---

## 1. The 2026 shape of the market in one table

| Dimension | What the field converged on in 2026 | Where Makeborne is today | Gap or lead |
|---|---|---|---|
| Entry | Prompt box, optional clarifying cards (Lovable design card, Base44 "one or two compact cards of up to three questions", Emergent E3 two rounds) | Brief → AI brief questions (Haiku, ≤4) → Create or Plan | Even |
| Plan tier | Cheap, editable, persisted plan (Lovable `plan.md` with highlight-to-diff; Base44 Plan mode; Bolt "Implement plan"; Replit Kanban drafts; Framer 3.0 plan-first; Wix Studio 2 Plan Mode) | Plan mode with stored, editable plan and credit estimate | Even; Makeborne's estimate before build is rare |
| Build loop | Agentic, visible tasks, 10-hour runs (Lovable), parallel isolated micro-VM tasks (Replit), orchestrator + testers (Emergent E3) | Single agent, 8–28 turns by effort, partial writes survive cut-off, hard credit ceiling | Lead on cost control; gap on verification depth |
| Verification | Browser testing subagents (Replit ~$0.20/session, Lovable "conservative"), streaming autofix model (v0), overflow/crop checks (Gamma 5), pre-publish review (Framer), security scan (Lovable, Bolt, Base44, Replit) | Screenshot self-review with overflow/broken-image/alt diagnostics; static import checks; no compile at finish; no link/form/axe check | Gap |
| Design quality | Generate inside a bounded system (Framer Styles/Components, Webflow classes, Relume 1,000 components, Lovable/Base44/Bolt/v0 design systems with raw-value linting) | 6.8k-token art-direction prompt; brand kits; curated 20-font library; no linting of the output against tokens | Lead in prompt discipline; gap in enforcement |
| Direct edits | Free, instant, no model (v0 Design Mode, Bolt Select, Lovable inline text 100/day, Base44 Edit mode, Replit Design Canvas) | Click-to-edit via source parse, free | Even |
| Credits UX | Cost shown after the run everywhere; check-ins (Lovable 20 credits), per-session budget (Emergent), confirm-before-paid (Replit), "Mark as Bad" refund (Framer), free failed browser actions (Base44) | Never charges unconfirmed usage; ceiling per effort; meter during run; no estimate before, no receipt with evidence | Lead in mechanics; gap in presentation |
| Publish | Snapshot publish with explicit "Publish changes" (Lovable, Bolt, v0); quick scans; SEO cards; invite-only or password previews | Prepare → review → publish; prerendered static snapshot; SEO cards; share image; business details | Even once trusted publishing is on |
| Client handoff | Content-only client role (Webflow Client Seats free, Framer Content Editor $10, Wix "Client", Relume free editors); transfer with agency staying on (Framer, Wix); client pays platform, agency earns commission (Framer up to 50%, Webflow, 10Web 7%) | Portal: client edits content, agency approves; review links; CRM delivery stages | Lead on approval; gap on transfer and commission |
| Review and approval | Comments only (Webflow comment links, Wix, Relume, Gamma, Pitch rooms with email capture, Lovable guest comments). Canva has internal approval gating. **No one has a client-facing approve → changes → approved state** | Approve or request changes, version-bound, delivery stage updates | Clear lead |
| Formats | App builders: apps. Canvases: sites. Gamma: decks, docs, sites. Bolt Slides and Base44 presentations: code or export, not design-grade. Books: typesetters without illustration, generators without print packaging | Website + deck (fixed canvas, native PPTX) + book (6×9 print, EPUB) in one brand | Clear lead, unproven in public |
| Credits and trust | Trustpilot: Lovable 4.2, Base44 2.8, Replit 2.8, Emergent 2.8, Gamma 1.7, Bolt 1.6, Framer 1.6. Top complaint everywhere: paying for the AI's mistakes; second: support and refunds | No published guarantee yet | Opportunity |

---

## 2. How each product actually works (compressed)

### App builders
- **Lovable.** Build / Plan / Chat modes; design-guidance card before first build (direction previews removed 8 Oct 2026 to cut friction); Agent Control Plane with append-only trajectories, background compaction and read-only subagents; routes >1B tokens/min across Anthropic, Vertex and Bedrock with per-project provider stickiness for prompt caching; four production models; browser testing "conservative by default… not reliable for subtle visual design"; TanStack Start SSR default; Lovable Cloud on Supabase; design systems with adherence linting that flags raw colours and one-off values; preview toolbar (Select, Text, Draw, Comment); Quick scan and Trust Center at publish; 5 free credits/day capped at 30/month. Does not do: CRM, white-label, approval, print, brand-consistent decks.
- **Bolt.new.** WebContainers in the tab (fastest first preview; preview ≠ production, the source of its deploy complaints); Standard/Max agents replaced model choice; "most token usage is related to syncing your project's file system to the AI"; Plan mode replaced Discussion mode (Aug 2026); Select-tool edits bill only on save; Bolt Slides is an MIT React deck framework; Trustpilot 1.6 with 83% one-star over token burn and whole-file rewrites.
- **v0.** Composite model: RAG → frontier model → Quick Edit model → streaming AutoFix (`vercel-autofixer-01`, 93.87% error-free vs Sonnet 4 at 64.71%); microVM previews since Feb 2026 "exactly as it would in production"; Design Mode edits without an LLM; Design Systems 2.0 as an adapter with the rule "if a component, prop, or token cannot be verified from the sources, v0 should not use it"; model picker removed then reinstated as four cost tiers within a year; $300–$2,000 fix-spiral complaints after the March 2026 relaunch.

### Full-stack builders
- **Base44 (Wix).** Thesis: the built-in backend. Plan mode with four-section tracker and four mockups; Build / Discuss (0.3 credit, cheap model) / Edit (free manual) modes; in-house Base 1 model lifted gross margin from near zero toward 60%; design systems generated from a URL or brand text and locked to admins; SPA-only output (no SSR) remains the biggest roadmap gap; Partner Directory with rates, client threads, card payments, credit delegation and app transfer, aimed at owning the agency–client relationship; Trustpilot 2.8.
- **Replit Agent 4.** Self-testing subagent writes Playwright code in a REPL (one loop instead of 36 model-driven clicks; ~1k-token stripped DOM with ARIA hooks the builder is told to add; median $0.20 per session) took autonomy from ~20 to 200+ minutes; tester kept outside the builder's 80–100k-token context; tasks run in isolated micro-VM copies and merge through a Kanban (Drafts → Active → Ready → Done); dev and production databases separated after the 2025 production deletion; Free Mode escalates to paid with notice; Trustpilot 2.8 over surprise bills.
- **Emergent.** Fixed stack (React, FastAPI, MongoDB); E3 orchestrator asks two rounds of scoped questions, writes a phased plan with acceptance criteria, runs a human-like testing agent; CEO: "verification is the loop which keeps the agent running"; per-session budget that pauses the agent; deployment engine V3 (immutable runs, blue-green, atomic pointer, Temporal) took deploy tickets from 5–10 a day to zero while the failure rate did not change "because most failures come from user code"; Trustpilot 2.8.

### Website builders for designers and SMBs
- **Framer 3.0 (16 Jun 2026).** Agent tab with model choice, plan-first, per-message revert, branches with "Apply to main", Skills (`design-system`, `remove-ai-writing`, `seo-check`) that travel with templates, MCP for Claude Code/Cursor/Codex on the user's own tokens, per-operation credit prices (~300 landing page, ~50 small edit) and "Mark as Bad" refunds, pre-publish review for contrast, typos, alt text, SEO. Project Transfers with the designer staying on; Experts earn up to 50% commission. No approval flow. G2 4.5 vs Trustpilot 1.6 over billing and lock-in.
- **Webflow.** AI Assistant generates sections only from the site's own classes and variables and refuses to invent elements or images; AI Site Builder emits several designs plus a style guide; Client Seats (free, content-only, 2 Feb 2026), legacy Editor retired 4 Aug 2026; client pays Webflow directly; comment-only review links; conservative "Bootstrap-style grids".
- **Durable.** Three questions → template filled in ~30 s; section-based editor, no free layout; retention through CRM, Stripe invoicing, Blog Agent, GEO tools; design 3.6/5; templates "look similar across industries".
- **Wix Harmony / Studio 2.** Aria explains "what it was building and why"; testers saw "the same fonts, colours and sections" across runs; Studio 2 adds Plan Mode briefs and AI Skills; Client collaborator role, transfer with agency as Co-Owner, Client Kit; comments only.
- **Hostinger AI Builder.** Manual mode (no credits) and Agentic mode merged Aug 2026; tester quit at 68 of 200 credits with the app unfinished because remaining work was impossible to estimate; data deleted when hosting lapses.
- **10Web.** WordPress + Elementor; white-label reseller tiers; client billing with 7% fee; Trustpilot dominated by auto-renewals.
- **Relume Publish (beta 24 Aug 2026).** "AI that assembles, not generates": Smart Project Brief fed by Notion docs, recordings and URLs; "Relumify" rebuilds an existing URL on human-made components; post-launch agents "propose, you decide"; unlimited free editors including clients; Publish MCP (14 Oct 2026).

### Decks and books
- **Gamma 5 (6 Oct 2026).** Fluid cards never overflow, which is why PPTX export flattens ~30% of slides and is the top complaint; themes control tokens, not layout; per-slide styling still per slide; Gamma 5 adds an agent, freeform canvas, overflow and crop checks, illustration over photoreal; export unchanged; Trustpilot 1.7 over silent model upgrades and bot support.
- **Beautiful.ai.** ~300 parametric Smart Slides rebalance as content changes; users cannot free-drag; ~85% editable PPTX.
- **Pitch Agent (27 May 2026).** Reads a template's spacing, block structure and image style, not only colours; bulk personalised decks from CRM variables; passcode and email-capture links with consent-based analytics; rooms; HubSpot deal cards. Closest to a client workflow; still no approval.
- **Plus AI.** Writes native Slides/PowerPoint (~95% editable); publishes a concrete template-import spec (max 25 layouts, one text box per style, decorative images in the master).
- **Canva AI 2.0.** Memory, connectors, Brand Intelligence, Magic Layers; only tool with admin approval gating download and publish (internal). Print export adds a fixed 3 mm bleed on all four sides, wrong for KDP interiors; no spine calculator.
- **Tome (closed 30 Apr 2025).** 20–25M users, ~$3.5M ARR, no PPTX export, decks deleted; founder: could not "make good presentations for people doing serious work"; the missing ingredient was customer context, now Lightfield CRM.
- **Books.** KDP is arithmetic (three-edge 0.125" bleed, gutter by page count, spine = pages × paper factor, even pages ≥24, embedded fonts, flattened transparency, Kindle fixed layout for picture books; AI-generated content must be disclosed even after heavy edits). Vellum, Atticus and Reedsy typeset text books and stop; children's-book generators solve character consistency with a reusable character asset and stop at a viewer; Inkfluence alone claims full KDP packaging for its niche. No tool shares a brand system across site, deck and book.

---

## 3. Twenty lessons for Makeborne (deduplicated across the four reports)

**Quality**
1. Constrain generation to a design system, then let the model compose inside it. The tools designers respect generate from a bounded vocabulary; the ones called generic generate freely. Makeborne's prompt is the vocabulary; enforcement (a token linter on output) is missing.
2. Variety must be explicit. Generate several directions and vary pairing, ground, density and image treatment, not only colour. Gamma's CEO: without "a step change in visual variety" its output "would look and feel too similar to all the other AI tools".
3. Verification is the autonomy lever, not the model. Cheap, always-on checks per format (compile, links, overflow, contrast, deck fit, print preflight) plus a rationed browser click-through.
4. Keep the tester out of the builder's context; return a works/broken summary.
5. Prompt the generator to emit stable ARIA and `data-testid` hooks so QA is cheap.
6. Never render text inside generated images; typeset everything.
7. Fixed canvas first for decks and pages; fluid is for the web. Treat PPTX as a first-class render target and measure editable-text rate.
8. Books are arithmetic: implement the KDP tables as code and generate the cover wrap from the frozen interior.

**Money and trust**
9. Show the price before, during and after; the receipt lists evidence (files changed, checks passed, screenshots).
10. Failed attempts are free, in writing. Add a "dispute this generation" action.
11. Make deterministic edits free and say so.
12. Cheap models for chatter, frontier for builds, visibly.
13. Hide model routing by default; expose Standard/Max tiers with the rate.
14. Clean export and honest renewal emails are the cheapest differentiators (lock-in and renewal shocks are the loudest complaints in every review set).

**Clients**
15. Approval is open territory: approve → changes → approved → published, with history visible to the client and comments that feed both the agent and the CRM timeline.
16. The client record is the brief. Nobody else closes that loop natively; "paste the client's current site" is the fastest agency sales motion.
17. Role-scoped, free client editing on the live preview, not a CMS table.
18. Transfer ownership with the agency staying on; let the client pay the platform and pay the agency a commission.

**Platform**
19. Be an MCP target (brief, plan, build, review, publish) so agencies can drive Makeborne from Claude Code or ChatGPT.
20. Reusable "skills" are how agencies encode taste; let a house style apply across websites, decks and books.

---

## 4. Where Makeborne wins, stated plainly

Nobody in these seventeen products offers all of: a client approval state, a white-label client portal with content-only editing, one brand across website, deck and print book, honest credits that never charge for unconfirmed work, and a CRM that feeds the brief. Framer has the design, Durable has the retention, Gamma has the formats, Base44 has the partner economy, Replit has the verification. The job is to prove the output quality publicly (golden set, instruments, blind comparison) and to close the five launch gates. The launch film should show exactly this: specific, different sites for different businesses, a client approving on a phone, and a book and deck in the same brand.
