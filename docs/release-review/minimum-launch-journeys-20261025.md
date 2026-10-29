# Minimum launch gate 5: header, GitHub export wording and client review (25 October 2026)

Status: **no reproducible defect in the candidate code; no code change.** The exact staging deployment could NOT be checked anonymously: Vercel deployment protection is on. Every staging step below is still open for Codex. All passing evidence in this report comes from the **exact candidate code run locally**. That is not staging evidence.

## What was checked, and where

| Target | What it is | Used for |
|---|---|---|
| Staging `dpl_DQeybc5KJAy7MMPdWf1aQuZKDY4R` (runtime e8ccef9) | https://makeborne-release-staging-dvqrlb4cg-kerimsabic-6594s-projects.vercel.app | Anonymous reachability only (curl, no cookies) |
| Local exact candidate | Branch `claude/minimum-launch-fixes` = 700a4e4 (e8ccef9 plus docs only). Built with `next build --webpack`, served by `next start` on port 3071 | Every journey below |

Local runtime details:
- The isolated release-auth stack only (API 127.0.0.1:55435, DB 127.0.0.1:55438).
- Every `ANTHROPIC_/OPENAI_/WHOP_/SUPABASE_/MAKEBORNE_/VERCEL/CRON_SECRET/AWS_/RESEND_/GOOGLE_/GITHUB_/CLOUDFLARE_` key and every `.env*` key was blanked, matching `scripts/local-release-server.mjs`.
- The builder was off (`GET /api/build` returned `{available:false}`).
- The build's browser chunks contain 0 cloud Supabase URLs and 5 references to 127.0.0.1:55435.
- The quality fixture account from `work/release-auth-stack/quality-fixture.json` was used, with the Saffron Table website `f70c3257…`.
- No external requests were recorded on any page.

Evidence location: the session scratchpad `launch-gates/staging/`. File names start with `local-candidate-*`; the JSON results are `local-candidate-results-{anon,header,github,review}.json`. The runner and Playwright script are `launch-gates/run-local.mjs` and `launch-gates/journeys.cjs`. They are not committed: they hard-code local paths and the fixture.

## 1. Staging, anonymous

- A request with no cookies to `/`, `/billing`, `/help`, `/login`, `/review/invalid` and `/review/<43-char token>` returns **302 to `vercel.com/sso-api`** in every case. Deployment protection is on, so a real anonymous client cannot open anything on this preview, including a review link.
- The built-in browser pane did load `/` and `/billing`, but only because it carries a persisted Vercel session. That is not an anonymous visitor and may be the owner's account, so I stopped there.
  - At 390px both pages showed no console errors and no horizontal scroll.
  - The round dark control at the right edge is the preview-only `<vercel-live-feedback>` toolbar, not the app.
  - These two observations are recorded for completeness only. They are **not** gate evidence.
- **Codex must supply one of two things:** a protection bypass (Vercel "Protection Bypass for Automation" secret, sent as the `x-vercel-protection-bypass` header in a clean browser context), or a deliberately unprotected staging alias. Nothing on staging was bypassed, signed into or written.

## 2. Anonymous public pages (local exact code)

Pages: `/`, `/billing`, `/help`, `/login`, `/review/not-a-token`, `/review/<well-formed unknown token>`, each at 390×844 and 1440×900.
- **PASS** for every page: HTTP 200, no horizontal scroll, no element past the viewport, no broken images, no failed requests, no console errors, no page errors, no external requests.
- **Invalid or unknown review token:** the page reads "This review link isn't available. Check that you copied the whole link, or ask the person who shared it for a new one." It sends `X-Robots-Tag: noindex, nofollow, noarchive`, `Referrer-Policy: no-referrer` and `Cache-Control: private, no-store`.
  - Observation, not changed: the response status is 200, not 404.
- **Turned-off link** (checked in the review journey): "This review link was turned off. The person who shared it has closed this link…" No composer is shown.
- `/help` has a second `<h1>` inside the demo player. That player is `aria-hidden` and `inert`, so this is not a defect.
- **Local-only artefact (not a defect):** browsing the `next start` server as `127.0.0.1` makes every same-origin POST (for example `/api/telemetry`) return 403, because Next reports `request.url` as `localhost`. Production `sameOrigin` deliberately has no loopback alias.
  - Reproduced with curl: Origin 127.0.0.1 gives 403; Origin localhost gives 204.
  - All journeys therefore ran on `http://localhost:3071`.
  - On Vercel, `request.url` carries the real host. Note for anyone using `scripts/local-release-server.mjs`, which serves on 127.0.0.1: telemetry 403s there are expected noise.

## 3. Signed-in editor header (local exact code)

The Saffron Table editor at 375×900, 800×900, 1440×900 and 2560×1300. Screenshots: `local-candidate-header-*`, `local-candidate-header-menu-*` and `local-candidate-editor-*`.

**PASS at every width:**
- The header is 52px, with no overflow, no clipped control and 0 overlaps between Back, title, save state, Publish and the menu.
- The document scroll width equals the viewport width.
- The title "Saffron Table" is not truncated.
- Save state is `saved`. At 375 it shows the icon only, with the full text in the title attribute and screen-reader text. From 800 up it reads "Saved".
- Publish is visible: x 230–321 at 375; flush right at the larger widths.
- The Project actions menu lists Version history, Client review and Download source, and stays inside the viewport at every width.
- Toolbar: no scroll overflow and no clipped controls. At 375 and 800 it shows Preview, Code, Edit and Preview options. At 1440 and 2560 it shows nine controls, including the device sizes, path, reload and full screen.
- No console errors, page errors or failed requests during the header run.

Other checks:
- Not exercised against the live stack (it would mean writing versions): the unsaved, saving and failed states, and long titles. The mounted `scripts/check-editor-header-browser.cjs` covers them; it was rerun on this exact code and passes (375, 800, 1440 and 2560 included).
- The only failed request on the editor is `GET …/publication/preparation` → **403 ACCESS_DENIED**. The cause is that trusted publishing is off and this is not an allowlisted account. This is the known publishing gate (Claude claim 3, "ordinary paying-workspace publishing"), not a header defect. The panel shows the publishing-off state.

## 4. GitHub manual export wording (local exact code)

The panel sits in the Publish view of the full-source website. Screenshots: `local-candidate-github-*` at 375 and 1440.
- **Real local state** (GitHub App not configured): "Your code, on GitHub · Keep a copy in your repository · Repository connections are being set up. Your work is saved here."
- **Not connected:** the real built panel, with only `GET /api/github/connection` and the artifact's GitHub status mocked in the browser. No GitHub request is made and nothing is clicked except navigation. It shows **Connect GitHub**, plus the description and the one-way note.
- **Connected:** the same mocking. Buttons: **Refresh repositories**, **Push version 17 to GitHub** and **Disconnect GitHub**. Status: "Pushed version 3 to … on branch …". Note: "One-way export of the full source … It only happens when you push a version here: saving doesn't update GitHub. Nothing is force-pushed, and changes made in GitHub aren't imported."
- Across all three states: **no "sync" anywhere** (case-insensitive). The manual-push, "saving doesn't update GitHub" and "aren't imported" checks are all true.
- **Import state:** the candidate contains **no GitHub import code or UI**: no import route, component or flag. The visible text has 0 import/pull controls. "Flag-off import" is therefore trivially satisfied: there is nothing to turn on. Continuous sync was not imported.
- The mounted `scripts/check-connections-browser.cjs` was rerun: 5/5, including the manual-push and no-sync assertion.

## 5. Client review journey, end to end (local exact code)

The owner and the client used separate browser contexts; the client was signed out. Screenshots: `local-candidate-review-*`.

**PASS:**
1. The owner opens Project actions → Client review, chooses Latest version, sets the client name and "In 3 days", then clicks Create review link. Result: 201, and the link has the shape `http://localhost:3071/review/<token>`.
2. The client opens the link at 390. Result: 200 with the noindex, no-referrer and no-store headers. The h1 is "Saffron Table", the website preview iframe renders, and there is no overflow at 390 or 1440.
3. The client types a name and a comment. The footer says "Saved on this device until you post · 81/2000".
4. Reload: the comment is **restored exactly**, with the notice "Your unsent feedback from 25 Oct, 18:18 UTC is back. Nothing has been sent. Discard".
5. Expected by design, and worth an owner UX note: the **typed but unsent name is not restored**. `unsent-feedback.ts` keeps the name and email out of the draft; they are stored only after a successful post. Posting without a name triggers the browser's required-field prompt on "Your name", focuses that field and keeps the comment. Once the name is filled, the post succeeds.
6. Post → 200. The comment appears under Comments and the composer is cleared. After a reload the composer is still empty, no restore notice appears (the sent text is not resurrected) and the comment persists.
7. The owner clicks Refresh client review and sees the comment. They click Turn off link and the panel says "Review link turned off." The client reloads and sees "This review link was turned off", with 0 Post buttons.
8. Client-side: 0 console errors, 0 page errors, 0 failed requests and 0 external requests.

The mounted `scripts/check-review-draft-restore-browser.cjs` was rerun: 4/4 in Chromium.

**Local cleanup** (isolated stack only):
- Both review links created in two runs are turned off: run 1 through the API after a script timeout, run 2 through the UI.
- The gate-5 comment is resolved.
- The fixture delivery stage is restored from `in_review` to `active` after each run.
- The local server is stopped. The worktree git status is clean.

## Defects and fixes

None. No reproducible defect in the candidate's header, GitHub export wording or client review journey, so `claude/minimum-launch-fixes` carries this report only and no code change. npm test, tsc and eslint were not rerun, because no code changed. Codex's candidate run stands: 186/186, tsc and eslint clean.

Observations for the owner, not defects:
- The review link page returns 200 rather than 404 for unknown, expired and turned-off links. It is noindex and no-store either way.
- A first-time reviewer who reloads before posting has to retype their name. The comment is kept.

## Exact staging steps for Codex

Prerequisites:
- An approved protection bypass for `dpl_DQeybc5KJAy7MMPdWf1aQuZKDY4R`. Prefer the automation bypass header in a fresh Playwright context; do not use a personal Vercel session for the client side.
- One non-admin staging fixture account that owns one saved full-source website (Codex holds staging access).
- Record the runtime: the URL, deployment id, and the `x-vercel-id` of the first response.

A. **Signed-in header** (fixture owner, its website editor):
1. At each of 375×812, 800×900, 1440×900 and 2560×1440, open `/studio?tab=projects&workspace=<ws>&artifact=<id>`.
2. Capture: a header screenshot (top 240px); the scroll width of `[data-editor-chrome="header"]` compared with its client width; the document's scroll width compared with the viewport; the title text and whether it is truncated; `.ph-save[data-state]` and its text; whether Publish is visible; and the Project actions menu items and their bounds.
3. For `.workbench-toolbar`, record scroll width against client width and any control outside the bar.
4. Pass when: nothing overflows, nothing overlaps, the menu sits in the viewport, the actions are Version history / Client review / Download source, there are no console errors, and the only failed request is the expected `publication/preparation` read while publishing is off.
5. Optional: type in the code view to see "Unsaved changes" + "Save now", then let it save. This writes a version, so only do it on the fixture.

B. **GitHub manual export panel** (same editor → Publish):
1. Capture the panel text and a screenshot at 375 and 1440.
2. If the staging GitHub App is not configured, expect "Repository connections are being set up."
3. If it is configured but not connected, expect Connect GitHub plus the one-way note.
4. If Codex connects a fixture GitHub account, also capture the connected panel. **Do not press Push** unless a fixture repository has been approved.
5. Assertions: no "sync" in the panel; the button reads "Push version N to GitHub" (or "Push published version to GitHub" for static sites); the note says saving or publishing doesn't update GitHub and that changes aren't imported; there is no import control.

C. **Real anonymous review link:**
1. As the fixture owner: Project actions → Client review → Latest version, client name `[gate5] <stamp>`, expiry "In 3 days" → Create review link. Capture the 201 and copy the link. **Never write the token into a report**; record it as `/review/<token>`.
2. In a fresh context with no Vercel or Makeborne cookies, sending only the bypass header, open the link at 390×844. Capture: status 200, the `x-robots-tag`, `referrer-policy` and `cache-control` headers, the h1, that the preview iframe renders, no horizontal scroll, and the console and page errors.
3. Type a name and a comment. Check the footer says "Saved on this device until you post", then reload.
4. Capture the restored comment (exact match) and the "Your unsent feedback … is back. Nothing has been sent." notice.
5. Re-enter the name if prompted (expected), then Post comment. Capture: 200 from `/api/review/<token>/comments`, the comment under Comments, the composer cleared, and after one more reload no restored text.
6. Owner: Refresh client review → the comment is visible.
7. Repeat at 1440 for the layout.
8. Optional: request changes with a note, then check "Changes requested by …".

**Cleanup (staging fixture rows only):**
- Turn off the link in the panel, then confirm the client reload shows "This review link was turned off".
- Resolve the gate-5 comment(s) (`PATCH …/review-comments/<id>` `{resolved:true}`).
- Restore the project's delivery stage if sharing moved it to `in_review`.
- Discard the client browser context. Revoke or expire the bypass if it was created only for this test.
