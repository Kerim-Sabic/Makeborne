# Owner setup checklist: CRM email, AI advisors and search

This guide prepares the release; production changes and deployment remain on hold until the owner approves the reviewed candidate. Test configuration belongs only to the separate staging project. Add production settings only during the approved release. Store secrets in hosting environment settings, never in the repo or chat.

Codex's local review is complete:62 migrations rehearsed,107 regression harnesses and build/typecheck passed. The review fixed mailbox ownership, uncertain sends, incomplete reply checks, research DNS pinning and lead-field permissions. See `docs/release-review/mail-owner-setup-local-20261013.md` for evidence and remaining live-provider limits. No production migrations or settings have been applied.

Owner steering2026-10-14: daily Anthropic capacity should grow with paying customers and measured demand. The planning policy is in `docs/AI_SPENDING.md`; no numeric initial ceiling or automatic adjustment mechanism is approved/configured yet. Spending activation remains held.

## 1. AI (advisors, personalised emails, drafts)
1. `ANTHROPIC_API_KEY`: already used by the builder; nothing new.
2. `MAKEBORNE_EXPERT_CHAT_ENABLED`: leave unset or set to `true` (set it to `false` to hide advisors and AI drafts).
3. Provider spending limits: text AI needs **both global and Anthropic** daily limits enabled by the database owner (`docs/AI_SPENDING.md`). Set an approved dollar cap for each; Anthropic alone does not open a disabled global gate. Leave OpenAI disabled until the image model is qualified. Daily limits do not replace the shared total testing budget. Current local provider limits remain off; launch cap and activation are separate decisions.
4. Advisor pictures: completed by Codex. Nova, Rex, Juno, Theo and Sage now have transparent square PNGs and `portrait: true`, matching the original three. See `docs/EXPERT_PORTRAITS.md`.

**Pricing as built:** advisors and AI emails cost 15× the provider cost on Haiku (about 0.3–0.5 credits per answer or email); Genius (Opus) costs 1.5× (about 2 credits). While credits are whole numbers, anything under 1 credit is charged as 1. **Fractional credits** need Codex's billing change (proposed in the handoff).

**Free:** sending emails, sequences, reply tracking, free lead research, lead scoring and the CRM itself use **no credits**.

## 2. Database
Three new migrations must be rehearsed by Codex/root and then applied to staging and production in order:
- `20261013240000_crm_email_automation.sql`: mailboxes, templates, sequences, enrollments, messages, sealed tokens.
- `20261013250000_crm_lead_profile.sql`: tags, deal value, source, lead profile on clients.
- `20261013260000_crm_mail_security_boundaries.sql`: private token authority, workspace-bound mail references and flat-array tag validation.
- (Plus Codex's own pending migrations.)

The repo's Supabase CLI is linked to **production**. Apply only through the reviewed release process, never with a bare `db push`.

## 3. Email from Gmail and Outlook
### 3a. Encryption key
Generate 32 random bytes and set their 64-character hex representation as `MAKEBORNE_MAIL_ENCRYPTION_KEY`. Keep a secure backup and use separate staging and production keys. Do not replace a key on connected mailboxes without a reviewed token re-encryption/rotation procedure; simply changing the setting makes stored tokens unreadable.

### 3b. Google (Gmail)
1. Go to https://console.cloud.google.com, create a project "Makeborne", and open APIs & Services.
2. **Enable APIs:** under Library, enable the **Gmail API**.
3. **OAuth consent screen:**
   - User type: External. App name: Makeborne. Support email: yours. Logo, homepage `https://makeborne.com`, privacy `https://makeborne.com/privacy`, terms `https://makeborne.com/billing/terms`. Authorised domain: `makeborne.com`.
   - Scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/gmail.send`, `https://www.googleapis.com/auth/gmail.readonly`.
   - Test users: add your own Gmail (and testers) while the app is in Testing.
4. **Credentials:** Create credentials → OAuth client ID → Web application.
   - Authorised redirect URI: `https://makeborne.com/api/mail/callback/google`. For staging, also add the staging URL with the same path.
   - Copy the values into `MAKEBORNE_GOOGLE_MAIL_CLIENT_ID` and `MAKEBORNE_GOOGLE_MAIL_CLIENT_SECRET`.
5. **Before public launch:** submit for verification (Publishing status → Publish app → Prepare for verification).
   - `gmail.send` is a *sensitive* scope: Google reviews the app (a demo video of the connect flow, your privacy policy). This usually takes days to a few weeks.
   - `gmail.readonly` (reply detection) is *restricted*: it needs a yearly independent security assessment (CASA), which costs money and time.
   - **Send-only is a separate implementation task. Do not just remove `gmail.readonly`.** The current connection reads the Gmail profile and the engine reads threads to stop sequences after replies. Send-only needs OpenID email identity, capability-aware reply checks, local Message-ID handling and an explicit sequence/manual-stop policy before it can be offered.
   - While the app is in Testing, use nominated testers only. Google normally expires refresh tokens for these mail scopes after seven days, so this is not a durable public-launch configuration. Scope verification and any required assessment must be completed for the intended public flow.

### 3c. Microsoft (Outlook / Microsoft 365)
1. Go to https://entra.microsoft.com → App registrations → New registration.
   - Name: Makeborne.
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
   - Redirect URI (Web): `https://makeborne.com/api/mail/callback/microsoft`.
2. **API permissions:** Microsoft Graph → Delegated: `Mail.Send`, `Mail.ReadWrite`, `User.Read`, `offline_access`, `openid`, `email`, `profile`.
3. **Certificates & secrets:** create a New client secret (24 months), and set a reminder to rotate it.
4. Set `MAKEBORNE_MICROSOFT_MAIL_CLIENT_ID` (the Application (client) ID) and `MAKEBORNE_MICROSOFT_MAIL_CLIENT_SECRET` (the secret value).
5. Optional but recommended: Branding & properties → set the publisher domain and complete **Publisher verification** (removes the "unverified" label). Some company tenants require admin consent before their staff can connect.

### 3d. Automatic sending (schedule)
1. Set `CRON_SECRET` (at least 32 random characters; it may already exist for billing).
2. Set `MAKEBORNE_MAIL_AUTOMATION_ENABLED=true`.
3. Schedule `GET https://makeborne.com/api/cron/mail` every 10 minutes with the header `Authorization: Bearer <CRON_SECRET>`.
   - On Vercel Pro, add to `vercel.json`: `"crons": [{ "path": "/api/cron/mail", "schedule": "*/10 * * * *" }]` (Vercel sends the secret automatically).
   - Or use any external scheduler.
4. Without the schedule, users can still press **Check now** in Email.

### 3e. Try it
1. Sign in, open Clients → **Email**, then **Connect Gmail**.
2. Pick a client with your own second address as their email, open their **Email** tab and send.
3. Reply from that second address, then press **Check now**. The reply appears, and the client moves to Conversation.

## 4. Search (SEO), AI search (GEO/AEO)
Already built:
- canonical URLs;
- a sitemap (home, help, pricing, privacy);
- robots rules with AI search crawlers named;
- `/llms.txt` (a factual overview for ChatGPT, Claude and Perplexity search);
- structured data (Organization, WebSite, SoftwareApplication with your three plans);
- social preview image and a web app manifest;
- private app pages set to noindex.

Your steps:
1. **Google Search Console:** https://search.google.com/search-console → add property `https://makeborne.com` (URL prefix) → HTML tag method.
   - Copy only the `content` value into `MAKEBORNE_GOOGLE_SITE_VERIFICATION`, redeploy, then click Verify.
   - Sitemaps → submit `https://makeborne.com/sitemap.xml`.
2. **Bing Webmaster Tools** (this also feeds ChatGPT search and Copilot): https://www.bing.com/webmasters → import from Search Console, or add the site.
   - For the meta tag method, set `MAKEBORNE_BING_SITE_VERIFICATION`, then submit the sitemap.
3. Check rich results: https://search.google.com/test/rich-results → enter `https://makeborne.com`. You should see Organization and SoftwareApplication.
4. After launch:
   - Keep `/help` growing with real how-to articles; answer engines quote pages that answer one question clearly.
   - Get listed where AI engines look: Product Hunt, G2/Capterra, relevant "best AI website builder" roundups.
5. `/billing/terms` now has public canonical/search metadata and is included in the sitemap. Preview deployments remain noindex; this local change becomes public only after an approved deployment.

## 5. Quick status
| Area | Built and tested | Needs you |
|---|---|---|
| CRM navigation, pipeline, ⌘K, CSV, quick follow-ups | Yes | — |
| Lead profiles, scoring, free research | Yes (live Instagram reads) | Migration apply |
| AI personalised outreach (Haiku) | Yes (8 live calls, $0.007) | Provider limits |
| Gmail/Outlook sending, sequences, replies | Yes (tested with fake mailboxes and the real database) | Sections 3a–3d |
| Advisors ×8 | Yes; all portraits added | Provider limits and final integration qualification |
| SEO/GEO/AEO | Yes | Section 4 |
