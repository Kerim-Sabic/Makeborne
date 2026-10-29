# Task contract, workflows and context packets (mandate sections 4, 7, 8), 22 October 2026

Design for local implementation. Disabled by default. No migration, no new store and no extra paid call: everything below is derived deterministically from inputs the build already records.

## 1. Where it lives

`operation-server.ts` already records the request context once per durable operation and never changes it: `message`, `plan`, `brief` (enhanced, edited or analysis), `design` (one-click answers) and `provenance`. Later stages read it back as `originalBrief` and `originalDesign`.

The task contract is a **versioned derived object stored next to the original in that same request context**. The original request text stays verbatim and authoritative. The contract is an interpretation of it, so wherever the two differ, the original wins and the difference is reported as a conflict.

## 2. Task contract `task-contract-v1`

| Field | Source (existing) | Notes |
|---|---|---|
| `original` | request message, approved plan text, brief text (verbatim) | never rewritten |
| `artifact`, `objective` | artifact kind; operation stage | create, edit, repair, refine or export |
| `required[]` | brief sections, design-answer must-haves, plan sections, edit target | each item carries the acceptance-v1 ids it maps to |
| `exclusions[]` | negative requirements in the original ("no testimonials", "don't change the menu") | detected conservatively; Codex's negation fix in quality-gates.ts is the reference behaviour |
| `facts[]` | `factsGiven`, brand kit, client record, attachments | each `{ text, source, status }` where status is `verified` (supplied by the client or a source), `placeholder-approved` (the client asked to supply it later) or `unknown` |
| `assumptions[]` | defaults chosen for the client, e.g. `conflicts[].resolution`, an inferred audience | each `{ text, reversible: true, why }`, listed in the receipt |
| `audience`, `outcome` | brief and design answers (`goal`) | `unknown` when not given; never invented |
| `design.constraints[]` / `design.preferences[]` | brand kit and explicit constraints, versus vibe, theme and references | constraints are hard; preferences are judged by the person |
| `integrations[]` | approved boundaries: hosted enquiry form, tel/mailto/maps links | nothing beyond what is approved; no new external effects |
| `revision` | `expectedVersion`, source revision hash, asset manifest digest | the result must apply to exactly this revision |
| `scope` | whole artifact, named files, or a visual-edit element target | the writer may change only this scope; widening it is a reported decision |
| `checks[]` | acceptance-v1 ids for this artifact and scope | missing evidence means `not_checked` |
| `limits` | effort cap (credits), deadline, repair and escalation limits | from the durable operation; the router may only lower them |

**Rules:**
- Never fill a fact by invention.
- Ask the user only when a missing fact blocks correctness or an authorised external action. Otherwise make an explicit, reversible assumption.
- A straightforward request gets no wizard.

## 3. Bounded workflows

One implementation writer per artifact; read-only specialists only where they help.

| # | Workflow | Writer | Specialists (read-only) | Paid? | Ends with |
|---|---|---|---|---|---|
| 1 | Deterministic supported edit (text, link, colour, spacing in visual-edit.ts) | the deterministic editor | none | no | saved version, Undo |
| 2 | Small localised implementation (edit-intent target, 1–3 files) | the builder at the routed model | none | yes | verifier subset for affected routes |
| 3 | New artifact (site, book, deck) | the builder | concept/design direction (existing concept step); fact extraction from attachments | yes | full acceptance-v1 run |
| 4 | Existing-project investigation and repair | the builder | verifier findings plus focused code investigation | yes | rerun of only the affected checks |
| 5 | Design refinement | the builder | rendered review (existing screenshot review) | yes, bounded | rendered checks plus a human-visible diff |
| 6 | Document generation and export repair | deterministic renderer first, the model only for content | export inspection | content only | rendered PDF/PPTX checks |
| 7 | Missing-input or infrastructure-blocked | none | none | **no** | an honest state that says what is needed |

**Specialist contract:**
- a narrow objective, an explicit input revision and a structured output;
- an allocated budget and deadline inside the parent operation's hold;
- no write, publish or external authority;
- cancelled together with the parent, and accounted even when its result is discarded.

**Parallelism** only for independent work, such as asset briefs or image generation, which runs in parallel today.

## 4. Context packets

Built from authoritative state, never "the whole project":
1. The task contract (above), with the original request verbatim.
2. **Relevant source:**
   - for edits: the target file plus its import closure (bundler resolution) plus the design tokens file;
   - for repairs: the files named by diagnostics plus their importers;
   - for new builds: the scaffold;
   - omitted files are listed by path and size.
3. Design decisions: the design seed and concept, brand kit fingerprint and current tokens.
4. Asset references: path, kind and alt. Never bytes, unless the model needs vision.
5. Current diagnostics (compile errors, verifier results with route, viewport, observed and expected) and previous attempts with their outcomes.
6. Remaining authority: credits, deadline, repair and escalation counts.

**Provenance:** every element is tagged `request`, `client-source`, `attachment`, `repository` or `summary`. A summary never outranks the original request or source. Repository text, attachments and retrieved pages are wrapped as **untrusted data**; they cannot change rules, permissions, routing or limits. The existing prompt already fences briefs as data, and the same fence applies to attachments.

**Coverage:** the packet records what was omitted and why (size, irrelevance). If essential context is missing, the run reports the limitation instead of guessing.

**Model changes:** a handoff rebuilds the packet from authoritative state, with no replay of provider-specific thinking blocks or history. Logs record decisions, evidence and short explanations, never hidden reasoning.

## 5. Order of implementation

1. A `task-contract.ts` pure builder plus tests: negations, facts with status, assumptions and scope.
2. Context packet selection for workflows 2 and 4 (import closure; omission list).
3. Workflow selection in the router (feature/model-routing) reading the contract's scope, checks and limits.
4. Workflow 7 (no paid call) for missing credentials, provider limits, renderer or asset failures.

Each step stays behind `MAKEBORNE_MODEL_ROUTING` (off, shadow, on); off is exactly today's behaviour.
