# Launch countdown and waitlist: production steps (27 October 2026)

Branches: `claude/launch-countdown-main` (from `origin/main` 39be650, for the production deploy) and
`claude/launch-countdown` (from Codex's release head 0877345, to carry into the release). Both have the same countdown,
reveal and waitlist code. They differ only in the sales gate (`src/lib/launch/sales-open.ts`: the checkout's env gate
on main, the database plan gate in the release) and in the billing page wiring. Nothing has been pushed, merged,
deployed, applied or sent.

## What it does

- **Before 2026-10-29T20:00:00Z** (Thursday 21:00 CET; moved from Wednesday 19:00 by the owner on 27 October), `/` is a full-page launch screen.
  - It has the wordmark, huge rolling figures (Geist), and the tagline.
  - It shows the date and the visitor's local time.
  - It has "Join the waitlist" (with a real "Join N others" line, shown only from 50 and rounded down to tens), an
    optional Sound toggle and the Instagram link. There's no Sign in.
  - In the final minute, the seconds take over the clock.
  - Other public pages (pricing, help, privacy and the legal pages) carry a slim, dismissible banner. `/billing` shows
    "Plans open in …".
- **At zero**, the figures roll away to "We're live.", and the live home page opens through an iris from its accent
  full stop. There's no reload. Reduced-motion visitors get a short cross-fade instead.
- **For 48 hours after launch**, the banner says "We're live". It links to plans only while the checkout's own gate is
  open; otherwise it says "Plans opening any moment". After that, everything hides itself.
- **The countdown is informational.** It never opens or closes sales.
- **The hidden sneak peek** is reveal-only. Nothing appears on its own:
  - With a mouse, a small, faint torch (260 px) follows the cursor. One website in a browser window sits somewhere
    off-centre behind the page; the torch uncovers whatever part of it the visitor finds.
  - After about 7 seconds of looking, the next reveal shows a different site in a different place (a continuous
    20-second look also moves on). The swap happens only while the torch is hidden.
  - On touch, press and hold the background, then drag. Quick swipes still scroll, and taps on the form and links
    work as usual.
  - The images are the owner's v14 website designs shown whole (navigation, headline and picture), in
    `public/launch/concepts/` (9 × 1440 x 810 WebP, at most 170 KB each, about 0.9 MB in total). They load only once
    the torch is first used, one ahead at most, and have no captions.
- **Sound** is off by default, synthesised with Web Audio, so there are no audio files.
  - Once turned on, it plays a soft tick each second, a very quiet pad, and a swell at the reveal.
  - It's capped by a compressor and a fixed ceiling, and paused in hidden tabs.
  - It's remembered on the device, but always starts from a click or key press.
- **Previews:**
  - `/?preview=site` shows the normal home page early. It's remembered for 7 days in a cookie; `/?preview=off`
    forgets it.
  - Outside production only: `?countdown=at:<ISO>`, `?theme=light` and `?waitlistCount=<n>`.

## Environment: nothing new is required

The code defaults are production-ready:

- `NEXT_PUBLIC_MAKEBORNE_LAUNCH_AT` defaults to `2026-10-29T20:00:00Z` (not set on Vercel, so the default applies).
- `MAKEBORNE_LAUNCH_COUNTDOWN` defaults to on. Exactly `on` keeps it on; any other value (for example `off`) turns it
  off everywhere.
- The waitlist salt uses `MAKEBORNE_WAITLIST_SALT` if it's set (at least 32 characters). Otherwise it's derived on the
  server as `HMAC-SHA256(SUPABASE_SECRET_KEY, "makeborne-launch-waitlist-salt-v1")`. The key itself is never used
  directly, and the salt is never logged.

The waitlist reuses env that main already depends on: `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`
(`sb_secret_…`, the same service key billing uses through `billingDatabase()`). If `SUPABASE_SECRET_KEY` is ever
rotated, set `MAKEBORNE_WAITLIST_SALT` first. Otherwise the IP hashes reset (that only affects the 10-minute limit) and
the unsubscribe links already emailed stop verifying.

## Production steps (in order)

1. **Apply the migration** to the production Supabase project, then run the security advisors. The file is
   `supabase/migrations/20261027020420_launch_waitlist.sql`. It's additive: one private table and five functions.
   - The table is `makeborne_private.launch_waitlist`. Row level security is on with no policies. No role has table
     privileges, not even service_role.
   - The functions are SECURITY DEFINER with an empty `search_path`. Each sits behind a `public.makeborne_*`
     security-invoker wrapper, and only `service_role` can execute it.
2. **Merge** `claude/launch-countdown-main` into `main`. Vercel deploys it.
3. **Smoke test on production:**
   - `GET /api/launch-status` returns `enabled: true` and `salesOpen` as expected.
   - `/` shows the launch screen.
   - `/?preview=site` shows the normal home page.
   - Join with your own address, then run the count query below.
4. **At 2026-10-29T20:00Z** (Thursday 21:00 CET), the reveal is automatic. Sales must open at the same moment (`WHOP_CREATION_ENABLED` and
   the release gates; that's Codex's release). Until they do, the banner honestly says "Plans opening any moment".

**If the migration isn't applied yet:**

- `POST /api/waitlist` answers 503 with `{"error":{"code":"WAITLIST_UNAVAILABLE","message":"The waitlist isn't available right now. Try again shortly."}}`.
  It logs only the database error code, never the address, and never returns a 500 or a stack trace.
- The "Join N others" line simply stays hidden.
- Unsubscribe links land on "Something went wrong".

## Invites at launch (nothing is sent automatically)

Invites go out **from `Makeborne <admin@makeborne.com>`**, reply-to admin@makeborne.com (the owner's choice, 27 October).
makeborne.com is a verified sending domain in Resend. This repository has no transactional mail sender: account
emails go through Supabase's own mailer. So `scripts/waitlist-invite.mjs` prepares the invite instead of sending it,
and nothing is sent until the owner says "send invites".

```
node scripts/waitlist-invite.mjs                                             # dry run: count pending invites and print the email copy
node scripts/waitlist-invite.mjs --export C:\path\outside\repo\invites.csv   # CSV + email copy; changes nothing
# send from admin@makeborne.com (one email per address; add the List-Unsubscribe headers from the CSV)
node scripts/waitlist-invite.mjs --mark-invited C:\path\outside\repo\invites.csv --approval "<your words>"
```

- **Environment for the script:** `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`, plus
  `MAKEBORNE_WAITLIST_SALT` if production sets one.
- **`--send` is refused** on purpose.

**Email copy** (subject: "Makeborne is live. Your invite is here."):

> Hi,
>
> You joined the Makeborne waitlist, so here is your invite: Makeborne is live.
>
> Create your account: https://makeborne.com/login?mode=signup&utm_source=waitlist&utm_medium=email&utm_campaign=launch
>
> Makeborne turns a short brief into a real website, a designed book or a presentation, and keeps your client work in one place. Every request shows its credit limit before it starts.
>
> If you make something you're proud of, reply and show us. We read every message.
>
> The Makeborne team
> makeborne.com · instagram.com/makeborne
>
> You're getting this one email because you joined the launch waitlist at makeborne.com.
> Unsubscribe: {unsubscribe_url}

## Counts (SQL editor)

```sql
select count(*) as total,
       count(*) filter (where invited_at is null and unsubscribed_at is null) as pending,
       count(*) filter (where invited_at is not null) as invited,
       count(*) filter (where unsubscribed_at is not null) as unsubscribed
from makeborne_private.launch_waitlist;
select coalesce(source, '(none)') as source, count(*) from makeborne_private.launch_waitlist group by 1 order by 2 desc;
```

## Retention and requests

The privacy notice says waitlist entries are deleted 90 days after launch, or sooner on request.

- **On or after 2027-01-26**, run `delete from makeborne_private.launch_waitlist;`.
- **For a single request**, run `delete from makeborne_private.launch_waitlist where email = lower('<address>');`.

## Rollback

- **Countdown:** set `MAKEBORNE_LAUNCH_COUNTDOWN=off`. Dynamic pages (`/`, `/billing`) follow it on the next request.
  Pages prerendered at build (help, privacy, billing terms) keep the banner until the next deploy. The banner also
  hides itself 48 hours after launch.
- **Waitlist:** the route is closed only if no salt can be formed. To pause it, revert the route or leave the migration
  unapplied; both answer with the friendly 503.

## Abuse and privacy notes

- **Joining is safe to repeat.** The same answer comes back for new and existing addresses, and the rate limit is
  checked first, for every address, so it can't be used to test membership.
- **Rate limit:** 5 new addresses per keyed IP hash per 10 minutes, and 5,000 an hour overall.
- **Bots:** a honeypot field catches simple bots.
- **Requests:** only same-origin JSON is accepted, at most 4 KB. Logs carry error codes only.
- **Single opt-in:** nobody is emailed on sign-up, and the one invite carries an unsubscribe link. Unsubscribing uses
  a confirmation page, so link scanners can't unsubscribe anyone, plus an RFC 8058 one-click endpoint.

## Checks

- **Offline:** `src/lib/launch/check-launch-countdown.cjs` and `src/lib/launch/check-launch-waitlist.cjs`. Both run in
  `npm test`.
- **SQL:** `scripts/check-launch-waitlist-sql.mjs` applies the migration to a disposable in-memory Postgres (PGlite)
  and checks it there. Run it with `MAKEBORNE_PGLITE=<path to @electric-sql/pglite>`.
- **Browser:** `scripts/check-launch-countdown-browser.cjs [shots] [--engine webkit|firefox]` runs against
  `next start` on localhost:3246 (3245 on the release branch).

## Production apply, 27 October 2026
Applied to production project rklojnmmsmhwnkbzuidp through the Supabase migration API on the owner's explicit approval ("yes, apply the waitlist migration to production and merge PR 19"). The recorded version is **20261027020420**, so the repository file was renamed to match.
Readback after the apply:
- count = 0;
- anon has no table SELECT and no EXECUTE on join;
- authenticated has no EXECUTE on pending;
- service_role has EXECUTE on join;
- the security advisor shows only the expected INFO "RLS enabled, no policy" for the new table, and no new WARN.
