# Launch countdown and waitlist: production steps (27 October 2026)

Branches: `claude/launch-countdown-main` (from `origin/main` 39be650, for the production deploy) and
`claude/launch-countdown` (from Codex's release head 0877345, to carry into the release). Both have the same countdown,
reveal and waitlist code. They differ only in the sales gate (`src/lib/launch/sales-open.ts`: the checkout's env gate
on main, the database plan gate in the release) and in the billing page wiring. Nothing has been pushed, merged,
deployed, applied or sent.

## What it does

- **Before `NEXT_PUBLIC_MAKEBORNE_LAUNCH_AT`**, `/` is a full-page launch screen. It has the wordmark, a rolling
  countdown, the date "Wednesday 28 October · 19:00 CET" plus the visitor's local time, the tagline, "Join the
  waitlist" and the Instagram link. There's no Sign in. Other public pages (pricing, help, privacy and the legal pages)
  carry a slim, dismissible banner. `/billing` shows "Plans open in …".
- **At zero**, the figures roll away to "We're live." Then the screen splits and lifts (1.4 s, ease-in-out-cubic) off
  the real home page, with no reload. Reduced-motion visitors get a 0.6 s cross-fade instead.
- **For 48 hours after launch**, the banner says "We're live". It links to plans only while the server says plans are
  on sale; otherwise it says "Plans opening any moment". After that, everything hides itself.
- **The countdown is informational.** It never opens or closes sales, and checkout keeps its own gate.
- **Owner preview:** `/?preview=site` shows the normal home page early, remembered for 7 days in a cookie;
  `/?preview=off` forgets it.
- **Testing outside production:** `?countdown=at:<ISO>` forces a launch moment, and `?theme=light` shows the light
  variant.

## Production steps (in order)

1. **Apply the migration to the production Supabase project.** The file is
   `supabase/migrations/20261027090000_launch_waitlist.sql`. Apply it with the SQL editor or `supabase db push`, then
   run the security advisors. It's additive: one private table and four functions.
   - The table is `makeborne_private.launch_waitlist`. Row level security is on with no policies. No role has table
     privileges, not even service_role.
   - The functions are SECURITY DEFINER with `search_path=''`. Each sits behind a `public.makeborne_*` security-invoker
     wrapper, and only `service_role` can execute it.
2. **Set the Vercel production environment variables** before the build. `NEXT_PUBLIC_` is inlined at build time.
   ```
   NEXT_PUBLIC_MAKEBORNE_LAUNCH_AT=2026-10-28T18:00:00Z
   MAKEBORNE_LAUNCH_COUNTDOWN=on
   MAKEBORNE_WAITLIST_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))">
   ```
   - `MAKEBORNE_WAITLIST_SECRET` keys the IP and browser hashes and signs unsubscribe links. It must be at least 32
     characters. Generate it once and store it only in Vercel and your password manager. Never commit it.
   - Without the secret, the waitlist answers "isn't available right now" and stores nothing.
   - The existing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` are reused.
3. **Merge and deploy:** merge `claude/launch-countdown-main` into `main`, and Vercel deploys.
4. **Smoke test on production:**
   - `GET /api/launch-status` returns `enabled: true`.
   - `/` shows the launch screen.
   - `/?preview=site` shows the normal home page.
   - Join with your own address, and check that it says "You're on the list…".
   - Run the count query below.
5. **At 2026-10-28T18:00Z**, the reveal is automatic. Sales must open at the same moment (`WHOP_CREATION_ENABLED` and
   the release gates; that's Codex's release). Until they do, the banner honestly says "Plans opening any moment".

## Invites at launch (nothing is sent automatically)

This repository has no transactional mail sender: account emails go through Supabase's own mailer. So
`scripts/waitlist-invite.mjs` prepares the invite instead of sending it.

```
node scripts/waitlist-invite.mjs                                  # dry run: count pending invites and print the email copy
node scripts/waitlist-invite.mjs --export C:\path\outside\repo\invites.csv   # CSV + email copy; changes nothing
# send from your mail tool (one email per address; add List-Unsubscribe headers from the CSV)
node scripts/waitlist-invite.mjs --mark-invited C:\path\outside\repo\invites.csv --approval "<your words>"
```

- **Environment for the script:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `MAKEBORNE_WAITLIST_SECRET`
  (the production value, so unsubscribe links verify).
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
- **Waitlist:** remove `MAKEBORNE_WAITLIST_SECRET` to close the form without a deploy; stored rows are kept. The
  migration can stay: it's private and unused without the route.

## Abuse and privacy notes

- **Joining is safe to repeat.** The same answer comes back for new and existing addresses, and the rate limit is
  checked first, for every address, so it can't be used to test membership.
- **Rate limit:** 5 new addresses per keyed IP hash per 10 minutes, and 5,000 an hour overall.
- **Bots:** a honeypot field catches simple bots.
- **Requests:** only same-origin JSON is accepted, at most 4 KB. Logs carry error codes only.
- **Single opt-in:** nobody is emailed on sign-up, and the one invite carries an unsubscribe link. Unsubscribing uses
  a confirmation page, so link scanners can't unsubscribe anyone, plus an RFC 8058 one-click endpoint.

## Checks run

- **Offline:** `src/lib/launch/check-launch-countdown.cjs` covers the time math, DST, zones, skew and the 48 h window.
  `src/lib/launch/check-launch-waitlist.cjs` covers validation, honeypot, idempotency, rate-limit mapping, hashing,
  signatures, the migration boundary and the consent/privacy text. Both run in `npm test`.
- **SQL:** `scripts/check-launch-waitlist-sql.mjs` applies the migration to a disposable in-memory Postgres (PGlite)
  and checks joins, idempotency, the rate limit, permissions, invites and unsubscribes. Docker wasn't responding here.
  Run it with `MAKEBORNE_PGLITE=<path to @electric-sql/pglite>`.
- **Browser:** `scripts/check-launch-countdown-browser.cjs` runs in Chromium and WebKit, at 390 and 1440 px, against
  `next start`.
