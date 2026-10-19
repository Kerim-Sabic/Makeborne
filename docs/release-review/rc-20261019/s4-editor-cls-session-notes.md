# S4 (editor CLS) ported onto release/rc-20261019 — 2026-10-19

Session "Port editor layout-shift fix onto release candidate", worktree `.claude/worktrees/gallant-mendeleev-ef56d2` (its branch reset to `5aff12c`, the RC tip; patch applied uncommitted). Nothing committed. The RC worktree and branch were not touched. Isolated release-auth stack only. No paid calls. Production and staging were not touched.

## Files (this folder)

- `s4-editor-cls.patch`: the Phase 2 S4 hunks only (from `zen-dhawan-0dfdd2`), rebased onto 5aff12c. sha256 `0271109b…c82a`. Applies cleanly to a clean 5aff12c index (`git apply --cached --check`).
  - `src/app/studio/page.tsx`: passes `initialProjectOpen` from `opensAccountProject()`.
  - `src/lib/studio-navigation.ts`: new `opensAccountProject()`, which uses the same parser as the client.
  - `src/components/studio.tsx`: the shell has `is-project-open` while `!loaded && initialProjectOpen`.
  - `src/components/account-projects.tsx`: a project link uses `account-project-open` from first paint.
  - `src/app/cloud-workbench.css` → `src/app/studio-refresh.css`: the `.account-projects.account-project-open` rule moved, so it no longer waits for the lazily loaded editor chunk.
  - `src/app/build-workspace.css`: `.studio-shell.is-project-open` goes from `display:block` to `display:flow-root`.
  - No S3/S5 (contrast/toolbar) hunks. The four TSX/TS files are byte-identical on f696b3a and 5aff12c, so those hunks are exactly Phase 2's.
- `s4-addendum-open-layout-inset.patch` (optional, applies on top of S4). sha256 `baee7576…c632`. It adds 2 CSS rules in `studio-refresh.css`. Why: with S4 alone, the open-project section has no padding. So "Checking your account…", "Loading your account projects…", "Opening project…" and a failed project link ("This artifact is unavailable." + "Back to projects") render flush in the top-left corner at (0,0). Before S4, the failed-link state was a padded card at (25,49). The addendum insets those children by 60px (left, right and top), the same spot as the studio's own "Opening your workspace…" placeholder. It uses padding, not margin, so the section box never moves. Editor CLS is unchanged with it (see the table).
- `s4-shots/`: `before|after|addendum-missing-1440.png` (failed project link), `addendum-missing-375.png`, `before|after-firstpaint-1440.png` (server-rendered first paint, JS off. Before: the projects layout with the sidebar. After: a white page with "Opening your workspace…".)

## Measurements

Studio e2e, specs `studio-quality` + `contrast`. Isolated release-auth stack (55435/55438), `next dev` on 127.0.0.1:3210, gate `baseline`, 11/11 passed on every run. Run dirs: `outputs/eval/e2e/rc5aff12c-{before,s4-after-1,s4-after-2,s4-addendum-1,s4-addendum-2}` in the worktree.

| key | 5aff12c (before) | + S4 (run 1 / 2) | + S4 + addendum (run 1 / 2) |
|---|---|---|---|
| **CLS editor@1440** | **0.1958** | **0.0005 / 0.0005** | **0.0006 / 0.0005** |
| **CLS editor@375** | **0.0989** | **0.0054 / 0.0057** | **0.0057 / 0.0057** |
| CLS studio@1440 / @375 | 0.0282 / 0.0085 | 0.0291 / 0.0085 · 0.0282 / 0.0093 | 0.0282 / 0.0153 · 0.0282 / 0.0085 |
| CLS home@1440 / @375 | 0 / 0 | 0 / 0 | 0 / 0 |
| contrast (studio, editor × 1440, 375) | 0 | 0 | 0 |
| axe serious / critical (all six keys) | 0 / 0 | 0 / 0 | 0 / 0 |
| overflowPx (all) | 0 | 0 | 0 |
| editor-toolbar@800 clipped | no | no | no |
| LCP editor@1440 / @375 (ms, dev server) | 1108 / 1032 | 1264, 1080 / 1040, 1044 | 1112, 1112 / 1044, 1032 |
| gaps to the bar | editor@1440 CLS | none | none |
| regressions vs baseline.json | 0 | 0 | 0 |

The before value matches the earlier launch-core measurements (0.1956 / 0.1957 / 0.1958 at 1440; 0.0989 at 375 on launch-core as is). Phase 2 measured 0.0004 / 0.0002 on its own base. The 375 result here (≈ 0.0055) is a little higher than that, because launch-core's phone-first editor is a different layout, but it is far under the 0.1 bar. One reading of studio@375 = 0.0153 is noise: `/studio` without an artifact never renders the changed selector or class, and the other four runs read 0.0085–0.0093.

Other checks on 5aff12c + S4 (+ addendum): `npx tsc --noEmit` passes. `npx eslint` on the 4 changed TS/TSX files passes. `npm test` gives 138/138, with 5 skips (server/fixture/time-boxed, as on the base).

## Suggested baseline change (when this lands)

In `scripts/eval/e2e/baseline.json`, `quality.editor@1440.cls` 0.1957 → ~0.0006 and `editor@375.cls` 0.1293 → ~0.0057, with a `changes` entry. Combine this with `baseline.after-q05.json` in the RC session's notes; that file left CLS unchanged. Not applied here.

## Worktree setup notes (for anyone repeating this)

- A `node_modules` junction pointing outside the worktree makes Turbopack panic ("Symlink [project]/node_modules is invalid, it points out of the filesystem root"). Run `npm ci` in the worktree instead (16 s from cache). A `scripts/eval/node_modules` junction is fine.
- Copy `work/release-auth-stack/{status.json,quality-fixture.json}` from the main checkout (gitignored), then run `node scripts/prepare-builder-runtime.mjs`.
