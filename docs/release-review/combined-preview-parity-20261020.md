# Combined rehearsal follow-up: editor/publication parity

## Current decision

Application candidate **`90df6b414c514e00a0dc0ce027038ffabed26035`** passes the local and staging checks below. The final checkpoint also adds test-runtime preparation and this report; those do not change application behavior. Remote checks on that final checkpoint must pass before any release approval. **No production change or launch activation is authorized by these results.**

This follows [the combined rehearsal](combined-rehearsal-20261020.md), whose original `abb1d08` results remain historical evidence for unchanged services.

## Real defect found and fixed

The golden QA site published correctly, but its actual editor preview could not compile `@fontsource-variable/fraunces`, `@fontsource-variable/dm-sans`, or its relative original-artwork import. Preview was empty and Edit disabled. This was an application defect, not a selector-only failure.

The browser bundler now:

- accepts bare/index imports only for fonts already present in the curated, pinned catalogue, with the correct static/variable package;
- embeds explicitly imported fonts even when the CSS family is computed;
- resolves relative, root and CSS references only to the supplied, already-authorized raster artwork map;
- refuses unknown fonts, unsupported package paths, SVG/executable artwork URLs, ambiguous source/artwork paths and traversal;
- replaces complete literal/URL references rather than rewriting matching bytes inside an embedded image. A real JPEG with a short `/9` path reproduced the old corruption before this correction.

No packages, external fetching, API permissions, server routes, migrations, publication-controller inputs, Worker code or immutable runtime images were changed. The original source/artwork is not rewritten by preview compilation.

## Qualification

| Gate | Evidence |
| --- | --- |
| Typecheck and full ESLint | Pass at `90df6b4` |
| Offline suite | 156/156 pass at `90df6b4` |
| Production webpack build | Pass at `90df6b4` |
| Complete 101-migration SQL chain | 62/65 pass, zero failures; same three documented environment skips |
| New real-browser regression | 12 groups, zero external network/provider calls; ordinary and instrumented bundles load fonts and relative/root/CSS artwork; negative cases refuse |
| Actual missing-runtime checkout | Generated runtime moved to a verified private backup; test regenerated it from locked installed dependencies and all 12 groups passed |
| Staging security | Identical 11 warnings, none new |
| Final staging deployment | `dpl_D7hxkqKTgY7CEDc5d58icgFes4Ny`, READY, preview environment |
| Final staged app rehearsal | Sign-in, 50+11 search, workspace/account isolation, Stop/reload/settlement, all three artifact create/save/replay/conflict flows, PDF/PPTX routes, anonymous review/comment/approval/revoke, phone billing; zero page errors |
| Real golden-site editor | Version comparison 1→3; compiled iframe heading selection opens editable element controls; no content saved, zero page errors |
| Cleanup | Disposable app users/workspaces/enquiry/client absent; original staging billing settings unchanged |

Staging URL: https://makeborne-release-staging-bqvotkhje-kerimsabic-6594s-projects.vercel.app . Only the existing staging QA alias moved. The published fictional QA site remains revision 4.

The three SQL skips remain `check-crm-mail-upgrade.sql`, `check-local-pilot-lock.sql`, and `check-mail-granted-scopes-upgrade.sql`. They are not passes. The app fixture was administratively confirmed and credit-exempt; it does not establish fresh confirmation-email delivery or a paying customer's purchase.

The extra read-only UI test initially had two selector errors (label matching and two equivalent close controls). After those were corrected it exposed the genuine empty-preview defect above. The final run waits for instrumented source markers and an actual text control, not merely an empty inspector shell. Its background telemetry POST was intentionally blocked; it makes no funnel-delivery claim.

## Remote-check setup correction

The first remote run of the new regression failed because clean CI runs checks before `next build`, and `public/builder-runtime` is generated and untracked. Local warm checkouts had those files. The harness now invokes the same trusted runtime preparer as prebuild, using installed locked dependencies and no external network. The actual missing-runtime test passed locally; the final clean Linux run remains the remote gate. This correction does not mask a browser compilation error or skip the regression.

## Unchanged evidence and spending

The previously qualified controller build/approval/publish, two public routes, menus, animations and phone form→inbox→CRM evidence remain attached to `abb1d08`. A changed-file/intersection check confirms neither changed application file is an input of that controller bundle; controller/Worker/SQL and pinned images are unchanged. No new cloud VMs or publishing jobs were purchased for this browser-only fix. This is explicit evidence reuse, not a claim that those VMs ran again at `90df6b4`.

The earlier actual cloud HTTP/SSE edit measured **$0.096806**, changed only the requested slide heading, saved revision 2 and settled with zero uncertain usage/overrun. Staging limits were restored and its account removed. That generation path is unchanged by this fix.

Same **$5 total** ledger: **$3.812877** conservatively accounted, **$1.187123** remaining. No additional paid AI calls were made for this follow-up. Credentials and raw receipts remain private.

## Remaining launch boundaries

1. The forthcoming weekly Whop renewal is a direct-provider probe with **no app checkout binding**. It can demonstrate provider renewal/signature behavior, not Makeborne account-bound credit delivery or monthly-plan eligibility. One-time follow-up starts before the 21 October 00:08:59 UTC cycle; do not invent a binding, use local signatures as provider proof, or activate payments automatically.
2. **Production publishing requires code integration, not just environment settings.** This candidate still has staging-only controller/broker guards. The separate uncommitted `feature/trusted-publication-production` worktree and migration `20261019134828_trusted_publication_production_profile.sql` were not silently merged here. Review, combine and rehearse them separately before production activation. Preserve that worktree.
3. OpenAI images, native Office rendering and production-specific identity/email/runtime checks remain unqualified where previously noted. Owner-required features must not be silently removed from launch scope.
4. Production backup, fresh migration baseline, reviewed environment/flag differences, an approved operating AI cap and the owner's explicit production go are still required. The $5 testing allowance is not an ongoing customer-generation budget.

Draft combined PR: https://github.com/Kerim-Sabic/Makeborne/pull/12 . Do not merge it based on this staging result alone. Source branches and production remain intact. Rollback/recovery instructions in the combined report still apply; never restore raw browser-output publication or widen the repaired database ACLs.
