# Acceptance contracts per artifact, 22 October 2026

Contract version `acceptance-v1`. This is the definition of "accepted" that the routing policy, repair loop and evaluations refer to. Each row is a named check.

- **Categories:** hard requirement (H), design requirement (D), operational requirement (O), preference (P).
- **Results:** `passed`, `failed` or `not_checked`. Each also carries its severity (blocker, major or minor), its coverage (which routes, viewports, pages, slides and exports were actually examined) and any uncertainty.
- **No single score.** Results are never compressed into one number. A D or P result can never compensate for a failed H.
- **What does not count as a pass:** a missing capture, an unrun check or a model's approval. A compile pass proves only that the code compiles.

## Websites

| Id | Cat | Requirement | Evidence (current source) | Status of the check |
|---|---|---|---|---|
| W-H1 | H | Compiles and every declared route renders a root with a visible h1, with no runtime or console errors | site verifier `route-load` | implemented (verifier) |
| W-H2 | H | Every asset resolves: no missing or blocked files, no broken images, no failed fonts | verifier `route-load`; preview asset loader | implemented |
| W-H3 | H | Internal links reach declared routes or anchors; unknown routes show not-found or home | verifier `navigation`, `unknown-route` | implemented |
| W-H4 | H | The requested functionality works: forms submit once to the isolated sink and state the outcome honestly; CTAs do something | verifier `form-*`, `primary-action` (heuristic) | implemented; CTA detection is heuristic |
| W-H5 | H | Business facts match the supplied sources; no invented testimonials, prices, awards, counts, contact details or integrations; negative requirements respected | finish gates (phone and contact rules, bracket rules), Codex's negation fix in quality-gates.ts | partially implemented; fact-to-source matching is not yet automated |
| W-H6 | H | Every brief-listed section or page exists | completeness gate (`check-brief-enhancer` "completeness gate") | implemented |
| W-H7 | H | Editable and exportable as promised: source download; publish compiles from the same bytes | publish compile; verifier `version` digest | implemented |
| W-H8 | H | Isolation: the generated site gets no platform credentials, no off-origin requests while being verified, permissions unchanged | isolated Chromium; publishing isolation | implemented locally; cloud not qualified |
| W-D1 | D | Responsive: no horizontal overflow at 360, 390, 820 and 1440; nothing covers the h1 or primary action; fixed bars at most 25% (35% in total) of a phone screen | verifier `overflow`, `occlusion`, `fixed-bars`; 360 px finish gate | implemented |
| W-D2 | D | Accessible: no serious axe violations; contrast ≥4.5:1 for text (rendered contrast gate); visible focus; reachable by keyboard; mobile menu closes with Escape | contrast gate, verifier `focus-visible`, `keyboard-*`, `mobile-menu-escape`, eval axe | implemented |
| W-D3 | D | Motion is purposeful and respects reduced motion | verifier `reduced-motion`; motion pattern | implemented |
| W-D4 | D | Intentional design suited to the subject: hierarchy, typography roles, colour roles, imagery direction, component language | design seed, concept step; blind human comparison; model critique as a supplement only | partially measurable; human-judged |
| W-O1 | O | Stop works at every stage; recovery preserves saved work; no duplicate charge or mutation; time and spend bounded; failures are honest | durable operations, enhancer E1-E4 checks, builder stop checks | implemented (local); staging by Codex |
| W-P* | P | Stated preferences (warmer, more editorial, less motion, a reference) | brief answers and design seed | recorded per request; judged by the person |

## Books

| Id | Cat | Requirement | Evidence | Status |
|---|---|---|---|---|
| B-H1 | H | Content complete: every requested chapter and section, and nothing silently cut | outline against rendered export | to implement (docs-quality) |
| B-H2 | H | Page-count contract. **Proposed:** the requested count means interior content pages. Cover, contents and end matter are reported separately; ±1 page tolerance is stated before the build. Never met by cutting content or shrinking text below the readable minimum | rendered PDF page count against the stated contract | to implement (Codex staging: 6 requested → 11 rendered) |
| B-H3 | H | Correct exported PDF: page size, trim and margins; text extractable; no Type 3 fonts in print output | PDF inspection | to implement (docs-quality) |
| B-H4 | H | No clipping, and no sparse pages from accidental overflow (for example a table pushed whole to the next page) | page-level render inspection | to implement |
| B-D1 | D | Readable typography: body size floor, measure, widows and orphans, chapter openers, lists inside notes kept | render inspection | in progress |
| B-D2 | D | Cover and openers suited to the subject; distinct covers for distinct books | render inspection | in progress |

## Presentations

| Id | Cat | Requirement | Evidence | Status |
|---|---|---|---|---|
| S-H1 | H | Slide count and narrative as requested | deck model against brief | partially implemented |
| S-H2 | H | Charts correct (data matches the source) and native/editable in PPTX | PPTX XML: native chart parts with embedded workbook | implemented (audit: 4/4) |
| S-H3 | H | Text is editable PPTX text; speaker notes where promised; real slide titles | PPTX XML | text and notes yes; titles to implement |
| S-H4 | H | No unfinished placeholders ("[x%]", "Replace this…") unless the client asked to supply them later | editor issues | to implement (docs-quality) |
| S-H5 | H | Every placed image is shown (none silently dropped) and none missing | scene against PPTX | to implement (docs-quality) |
| S-D1 | D | Readable layouts at 960×540; label contrast ≥4.5:1; no struck-through headings or phantom gaps; balanced title breaks in both HTML and PPTX | render and PPTX inspection | in progress |
| S-D2 | D | A purposeful closing slide (not a tiny joined checklist) | render inspection | in progress (Codex staging finding) |
| S-D3 | D | Purposeful imagery per slide with text-safe zones (image-led) | render inspection; A/B pending | in progress |

## Operational (all artifacts)

- **O1 Stop:** Stop prevents new work and invalidates promotion of stale results.
- **O2 Idempotence:** replays and duplicate callbacks produce no duplicate charge or mutation.
- **O3 Bounded:** time, spend, attempt and escalation counts survive restarts.
- **O4 Revisions:** a result can't overwrite a newer user revision.
- **O5 Honest failures:** failures are reported honestly, and infrastructure failures are never escalated to a stronger model.

Evidence: durable operations and enhancer actions (implemented locally); routing escalation state (in progress, feature/model-routing).
