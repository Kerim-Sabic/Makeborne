# Review link view tracking

When someone opens a client review link (`/review/[token]`), the person who shared it can see that the link was opened, how long it was open, which device class was used, and which slides, chapters or sections got the most attention. For example: "Opened 3 times · 2 visits · 9 min in total · last opened 2h ago. Most time: Slide 6 · Pricing (4 min)."

**Status:** the code is in the repository. The migration has only been rehearsed inside a rolled-back transaction on the local `makeborne-fresh-quality` stack. It has not been applied to any database. Until it is applied, the review page works as before, the heartbeat route answers `204` and does nothing, and the Client review panel says "View tracking is being set up".

Related: client review links come from `supabase/migrations/20261011130000_client_review_links.sql` and `20261013160000_client_review_view_integrity.sql`.

## What is stored

One row per **view session** in `public.client_review_views`. A view session is one browser tab on one review link.

| Column | Meaning |
| --- | --- |
| `link_id`, `workspace_id` | The review link and its workspace. The row is deleted with the link (`on delete cascade`). |
| `session_id` | A random UUID that the viewer's browser creates and keeps in `sessionStorage` for that tab. It is not a cookie and is never sent automatically. Workspace members cannot read it. |
| `started_at`, `last_seen_at` | The first and the latest heartbeat. |
| `active_seconds` | Seconds the tab was visible. It never decreases. Each heartbeat adds at most 60 seconds, and never more than the time that has actually passed since the previous heartbeat plus 5 seconds. A session stops at 4 hours. |
| `opens` | Page loads in the same tab, from 1 to 1000. A reload is another open of the same visit. |
| `device` | `phone`, `tablet` or `desktop`. The browser works this out from the screen's short side and pointer type, and only sends the class. |
| `pages` | Seconds per location, for example `{"slide:5": {"s": 120, "l": "Slide 6 · Pricing"}}`. There are at most 200 locations per session, each capped at 4 hours, with labels of up to 80 characters (control and bidi-override characters are removed). |

**Never stored:** IP addresses, user agent strings, cookies, referrers, names, emails, or anything typed on the page. The route never reads the `User-Agent` or forwarding headers. There are no third-party scripts.

### Locations

| Review content | `ref` | Label |
| --- | --- | --- |
| Deck (document) | `slide:N`, the slide most in view in the review frame | `Slide 6 · Pricing` |
| Deck (outline) | `slide:N`, the slide shown | `Slide 6 · Pricing` |
| Book (document) | `chapter:N` (opener and text), `page:0` (cover), `front:contents`, `front:pages` | chapter title, `Cover`, `Contents`, `Opening pages` |
| Book (outline) | `page:N`, the page shown | `Cover`, `Page 3` |
| Website | `section:N`, the outermost header/section/footer most in view | heading text, `Header`, `Footer` |

A website review shows one static page (the review snapshot), so there is no route path to record. The section in view is the useful signal instead.

## How it works

```
/review/[token]  ClientReviewBeacon (src/components/client-review-beacon.tsx)
   ViewClock counts visible time per location (src/lib/client-review/views.ts)
   every 15 s while visible, and on visibilitychange→hidden / pagehide (navigator.sendBeacon)
   POST /api/review/[token]/view  {session, device, open, slices:[{ref,label,seconds}]}  (≤ 4 KB, text/plain)
      → public.makeborne_record_client_review_view(p_token, p_session, p_device, p_open, p_slices)
Studio  GET …/artifacts/[artifactId]/reviews       → views: {available, byLink}  (Client review panel)
        GET …/clients/[clientId]/reviews           → items[].views              (client page feed)
```

- **Route** (`src/app/api/review/[token]/view/route.ts`): nodejs runtime, same-origin check, token format check, body limited to 4 KB, strict schema. It **always answers 204** with no body, whether the input is bad, the link is closed, the table is missing or the database fails, so tracking can never break the review page. It uses the anonymous review database client. When the request carries a Supabase session cookie, it uses the cookie-bound client instead, so the database can recognise the workspace's own people.
- **Owner and member previews are not counted.** When the caller is signed in and `makeborne_private.can_read(workspace)` is true, the function returns `{recorded:false, reason:"member"}` and writes nothing. A signed-in person from another account, such as a client who also uses Makeborne, is counted like anyone else.
- **Function** (`security definer`, `search_path=''`): validates every slice before writing anything (`22023`). It finds the link through the shared `makeborne_private.client_review_live_link` helper, so only active, unexpired links whose creator can still edit are accepted (`P0002`). It allows at most one heartbeat per second per session (later ones return `throttled`), at most 20 slices per heartbeat, and at most **200 new sessions per link** and **5,000 per workspace** in any 24 hours (`MB429`, serialised per link with a transaction advisory lock). Existing sessions continue past the limit.
- **Reads:** RLS policy `client_review_views_read` uses `makeborne_private.can_read(workspace_id)`. `authenticated` has column `select` on every column except `session_id`. Browsers have no insert, update or delete rights. `anon` has nothing. `service_role` has the usual full grant.
- **Owner summaries** (`summariseViews`): opens, visits (sessions), total time, last opened, device mix, time per location (top 50, with the latest label), and the 5 most recent visits. The routes read at most 3,000 of the latest sessions for the links shown. A missing table (`42P01`/`PGRST205`) becomes `{available:false, reason:"setup"}`. Any other read error becomes `reason:"error"` and never fails the panel.
- **CRM:** the client page feed shows "Viewed <title> · 4 min · 2h ago" entries next to comments. Nothing is written to the client record.

The older `client_review_links.view_count` counter (which counts every page render, including the owner's) is unchanged. The panel shows it only while view tracking isn't available.

## Checks

- `supabase/check-review-link-views.sql`: one transaction that ends in `ROLLBACK`, with 9 PASS groups covering shape, grants, open/throttle/wall-clock/60 s caps, the 4 h cap and 200-page limit, malformed input, closed links, member exclusion and RLS, daily limits, and cascade. It was run locally as `begin; <migration body>; <check body>; rollback;` piped into `docker exec -i supabase_db_makeborne-fresh-quality psql -U postgres`. Nothing was persisted.
- `src/lib/client-review/check-review-views.cjs` (15 groups): schema bounds, the beacon clock, summaries and their bounds, wording, owner reads, the real heartbeat route with mocked database and cookies, a server render of the owner stats, and the migration, beacon, page, panel and feed wiring. It runs in `node scripts/run-checks.mjs`.

## Release steps (owner + Codex)

1. Rehearse: run `supabase/check-review-link-views.sql` against a disposable copy with all earlier migrations applied (or include it in the candidate rehearsal). Confirm all 9 PASS lines and the final `ROLLBACK`.
2. Apply `supabase/migrations/20261015100000_review_link_views.sql` with the normal release process. It is additive: one table, one index pair, one policy and one function. It does not change any existing object.
3. Deploy the app. Without the migration, the app runs safely in "being set up" mode. Deploying the app before the migration is fine, and so is the other order.
4. Update Makeborne's privacy policy. The review page's privacy note now also says: "The team also sees when this page is opened, for how long and which parts are viewed, but never your location or browser details."
5. Rollback: drop `public.makeborne_record_client_review_view` and then `public.client_review_views`. Nothing else references them.

**Retention:** rows live as long as their link. Links last at most 90 days but are revoked, not deleted, so rows stay until the link is deleted. There are at most 200 new sessions per link per day. Add a scheduled purge, for example of rows older than 180 days, if retention needs to be shorter.
