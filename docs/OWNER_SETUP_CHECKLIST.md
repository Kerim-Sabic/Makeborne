# Owner setup checklist: CRM email, AI advisors and search

This guide prepares the release; production database changes and deployment remain on hold until the owner approves the reviewed candidate. Test configuration belongs only to the separate staging project. On October14 the owner explicitly approved preparing production and staging mail credentials/server settings with automation disabled; this exception does not authorize deployment or sending. Store secrets in hosting environment settings, never in the repo or chat.

Codex's local review is complete:63 migrations rehearsed,107 regression harnesses and build/typecheck passed. The review fixed mailbox ownership, uncertain sends, incomplete reply checks, research DNS pinning and lead-field permissions, and added explicit Gmail granted permissions. See `docs/release-review/mail-owner-setup-local-20261013.md` and `candidate-rehearsal.json` for evidence. No production migrations have been applied. The owner separately approved preparing mail credentials in Vercel on October14; this is configuration preparation, not a deployment or permission to activate sending.

Owner steering2026-10-14: daily Anthropic capacity should grow with paying customers and measured demand. The planning policy is in `docs/AI_SPENDING.md`; no numeric initial ceiling or automatic adjustment mechanism is approved/configured yet. Spending activation remains held.

## 1. AI (advisors, personalised emails, drafts)
1. `ANTHROPIC_API_KEY`: already used by the builder; nothing new.
2. `MAKEBORNE_EXPERT_CHAT_ENABLED`: leave unset or set to `true` (set it to `false` to hide advisors and AI drafts).
3. Provider spending limits: text AI needs **both global and Anthropic** daily limits enabled by the database owner (`docs/AI_SPENDING.md`). Set an approved dollar cap for each; Anthropic alone does not open a disabled global gate. Leave OpenAI disabled until the image model is qualified. Daily limits do not replace the shared total testing budget. Current local provider limits remain off; launch cap and activation are separate decisions.
4. Advisor pictures: completed by Codex. Nova, Rex, Juno, Theo and Sage now have transparent square PNGs and `portrait: true`, matching the original three. See `docs/EXPERT_PORTRAITS.md`.

**Pricing as built:** advisors and AI emails cost 15× the provider cost on Haiku (about 0.3–0.5 credits per answer or email); Genius (Opus) costs 1.5× (about 2 credits). While credits are whole numbers, anything under 1 credit is charged as 1. **Fractional credits** need Codex's billing change (proposed in the handoff).

**Free:** sending emails, sequences, reply tracking, free lead research, lead scoring and the CRM itself use **no credits**.

## 2. Database
Four new mail/lead migrations have been rehearsed locally and must be applied through the reviewed staging/release process in order:
- `20261013240000_crm_email_automation.sql`: mailboxes, templates, sequences, enrollments, messages, sealed tokens.
- `20261013250000_crm_lead_profile.sql`: tags, deal value, source, lead profile on clients.
- `20261013260000_crm_mail_security_boundaries.sql`: private token authority, workspace-bound mail references and flat-array tag validation.
- `20261013270000_mail_granted_scopes.sql`: validated provider-returned permissions; legacy Gmail connections need reconnecting, not invented read/send grants.
- (Plus Codex's own pending migrations.)

The repo's Supabase CLI is linked to **production**. Apply only through the reviewed release process, never with a bare `db push`.

## 3. Email from Gmail and Outlook
### 3a. Encryption key
Generate 32 random bytes and set their 64-character hex representation as `MAKEBORNE_MAIL_ENCRYPTION_KEY`. Keep a secure backup and use separate staging and production keys. Do not replace a key on connected mailboxes without a reviewed token re-encryption/rotation procedure; simply changing the setting makes stored tokens unreadable.

### 3b. Google (Gmail)
1. Dedicated project prepared: **Makeborne CRM Mail**, `gold-vault-511623-f4`, under `kerimsabic69@gmail.com`. Keep it separate from existing Google sign-in credentials.
2. **Enable APIs:** under Library, enable the **Gmail API**.
3. **OAuth consent screen:**
   - User type: External. App name: Makeborne. Support email: yours. Logo, homepage `https://makeborne.com`, privacy `https://makeborne.com/privacy`, terms `https://makeborne.com/billing/terms`. Authorised domain: `makeborne.com`.
   - Launch scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/gmail.send`. Set `MAKEBORNE_GOOGLE_MAIL_MODE=send_only` explicitly in both environments. Do not request inbox-reading scopes for this launch.
   - Test users: add your own Gmail (and testers) while the app is in Testing.
4. **Credentials:** Create credentials → OAuth client ID → Web application.
   - Use separate production and staging clients. Production callback: `https://makeborne.com/api/mail/callback/google`. Prepared staging callback: `https://makeborne-release-staging-feavd3cd1-kerimsabic-6594s-projects.vercel.app/api/mail/callback/google`; replace it with the exact final preview before qualification, or adopt a reviewed stable staging hostname.
   - Copy the values into `MAKEBORNE_GOOGLE_MAIL_CLIENT_ID` and `MAKEBORNE_GOOGLE_MAIL_CLIENT_SECRET`.
5. **Before public launch:** submit for verification (Publishing status → Publish app → Prepare for verification).
   - October14: the owner approved publishing the Google consent configuration to open review preparation. This is Google OAuth status only, not a Makeborne deployment/activation. Scope verification is not submitted yet. The live privacy page is still the October5 version and does not describe connected CRM mail; the updated local privacy notice and actual OAuth/send demonstration must be qualified before a truthful submission. Both client callback domains must pass ownership requirements; the exact staging Vercel hostname is auto-added to branding and needs a reviewed ownership/isolation solution.
   - `gmail.send` is a *sensitive* scope: Google reviews the app (a demo video of the connect flow, your privacy policy). This usually takes days to a few weeks.
   - `gmail.readonly` (reply detection) is *restricted*: it needs a yearly independent security assessment (CASA), which costs money and time.
   - **Sending-only is implemented locally:** verified OpenID identity, provider-returned granted permissions, local outgoing Message-ID, and server-enforced read/automation restrictions. It supports manually reviewed sends; reply tracking and automatic Gmail sequences are unavailable. Existing broader grants cannot bypass send-only mode. Qualify a real connect/send/reply-in-sent-thread flow on the final staging candidate before offering it publicly.
   - While the app is in Testing, use nominated testers only. Google normally expires refresh tokens for these mail scopes after seven days, so this is not a durable public-launch configuration. Scope verification and any required assessment must be completed for the intended public flow.

**Google review preparation, October14 (not submitted):**

- Consent configuration is now **In production, unverified**, by explicit owner approval. Makeborne itself was not deployed or activated.
- First automatic branding check rejected newly propagated ownership and the standalone monogram. The domain is already verified in Search Console and its owner is now a project Editor; Google's issue panel asks to wait24h before retrying. Consent logo was corrected to current mark plus the Makeborne wordmark. Approval remains unproven.
- Scope verification cannot begin until branding passes. The live privacy page is still the October5 notice, missing connected CRM-mail processing; the corrected local page must go through approved release preparation.
- Proposed scope justification for the actual reviewed flow: users explicitly connect their own Gmail account and manually review recipient, subject and message before sending CRM correspondence from their mailbox. `gmail.send` is required for `users.messages.send`. Identity comes from OpenID; the app requests no inbox-reading scope, scans no inboxes and does not offer automatic Gmail sequences in this mode. Store only encrypted OAuth credentials, connection identity, user-authored outgoing messages and returned delivery identifiers for CRM history. Confirm these statements against the live candidate/demo before submission.
- Required real demo: sign in → Clients/Email → Connect Gmail → show exact consent scopes → choose a client using an owned test address → review/send → show delivery and CRM history → disconnect/revocation. Include a sent-thread reply test separately. Do not substitute mocked tests or a promotional film for the actual permission flow.
- Before final review, resolve staging callback ownership: verify the exact Vercel URL-prefix property using the reviewed staging candidate, adopt a reviewed stable subdomain under makeborne.com, or separate staging into its own OAuth project. Both clients currently belong to the dedicated mail project; the staging hostname was automatically included in branding.

Evidence: screenshots in `work/owner-cloud-setup-20261014/`, plus `work/gmail-send-only-checks-20261014.log` and `work/gmail-send-only-build-20261014.log`. Secrets exist only in matching Vercel settings; automation=false and send_only were read back for both environments. No real email sends or paid API calls in this setup package.

### 3c. Microsoft (Outlook / Microsoft 365)
**Deferred for first launch by the owner on October14.** Leave Microsoft credentials unset; Gmail manual sending is the selected launch path. The steps below remain for a later connector release.
1. Go to https://entra.microsoft.com → App registrations → New registration.
   - Name: Makeborne.
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
   - Redirect URI (Web): `https://makeborne.com/api/mail/callback/microsoft`.
2. **API permissions:** Microsoft Graph → Delegated: `Mail.Send`, `Mail.ReadWrite`, `User.Read`, `offline_access`, `openid`, `email`, `profile`.
3. **Certificates & secrets:** create a New client secret (24 months), and set a reminder to rotate it.
4. Set `MAKEBORNE_MICROSOFT_MAIL_CLIENT_ID` (the Application (client) ID) and `MAKEBORNE_MICROSOFT_MAIL_CLIENT_SECRET` (the secret value).
5. Optional but recommended: Branding & properties → set the publisher domain and complete **Publisher verification** (removes the "unverified" label). Some company tenants require admin consent before their staff can connect.

### 3d. Automatic sending (schedule)
1. A separate `CRON_SECRET` is prepared in each Vercel environment. Do not replace an existing scheduler's secret without coordination.
2. Keep `MAKEBORNE_MAIL_AUTOMATION_ENABLED=false` for this release. Enable only after reply tracking, provider permissions and scheduling have been qualified.
3. Schedule `GET https://makeborne.com/api/cron/mail` every 10 minutes with the header `Authorization: Bearer <CRON_SECRET>`.
   - On Vercel Pro, add to `vercel.json`: `"crons": [{ "path": "/api/cron/mail", "schedule": "*/10 * * * *" }]` (Vercel sends the secret automatically).
   - Or use any external scheduler.
4. Vercel is currently Hobby: a ten-minute cron requires Pro (or a separately reviewed external scheduler). No invalid cron was added to `vercel.json`. The sending-only Gmail launch does not require this job; **Check now** cannot read Gmail replies in send-only mode.

### 3e. Try it
1. Sign in, open Clients → **Email**, then **Connect Gmail**.
2. Pick a client with your own second address as their email, open their **Email** tab and send.
3. Check the recipient inbox and Gmail Sent folder, then send one reply from Makeborne to the stored sent thread and verify threading. In send-only mode, incoming replies stay in Gmail; update the CRM manually. No incoming-reply or automatic-stage claim is valid for this mode.

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
1. **Google Search Console completed October14:** `makeborne.com` domain property verified under `kerim.sabic@gmail.com` through a dedicated DNS TXT. `https://makeborne.com/sitemap.xml` submitted successfully.
2. **Bing Webmaster Tools completed October14:** `https://makeborne.com/` verified under the same account through its account-specific DNS CNAME. Sitemap submitted and processing. No Search Console account-wide import permission was granted.
   - Keep both ownership DNS records. No verification environment variable or app deployment is needed for these DNS methods. Indexing/ranking/citation performance remains unproven.
3. Check rich results: https://search.google.com/test/rich-results → enter `https://makeborne.com`. You should see Organization and SoftwareApplication.
4. After launch:
   - Keep `/help` growing with real how-to articles; answer engines quote pages that answer one question clearly.
   - Get listed where AI engines look: Product Hunt, G2/Capterra, relevant "best AI website builder" roundups.
5. `/billing/terms` now has public canonical/search metadata and is included in the sitemap. Preview deployments remain noindex; this local change becomes public only after an approved deployment.

## 4b. Lead finder and help center (Claude, 2026-10-14)
- **Lead finder** (Clients → Find leads) needs the same AI setup as section 1, nothing else. It uses Haiku for ranking and charges about 1 credit per 5 leads delivered, only when leads come back.
- **Map data:** local-business search uses the free public OpenStreetMap services (Nominatim and Overpass), with a clear User-Agent, a 6-hour cache, one query at a time per server and backup mirrors. When the map is busy or thin, the finder automatically searches the web instead, so users always get results. A dedicated Overpass server (`MAKEBORNE_OVERPASS_URL`) is optional and only saves the web-search cost of fallbacks at high volume. The attribution "© OpenStreetMap contributors" is shown with map results.
- **Creators (Instagram, TikTok, YouTube) and web fallback:** these use Anthropic web search ($10 per 1,000 searches, at most 3–4 per lead search, priced into credits). It is on by default; keep **web search enabled** in the Claude Console under Settings → Capabilities (if an admin turns it off, creator search shows a clear error and charges nothing).
- **Help center** (`/help` plus 15 guides at `/help/<guide>`, each with a pre-scripted animated demo and no AI): already in the sitemap and `llms.txt`. Nothing to configure.

## 5. Quick status
| Area | Built and tested | Needs you |
|---|---|---|
| CRM navigation, pipeline, ⌘K, CSV, quick follow-ups | Yes | — |
| Lead profiles, scoring, free research | Yes (live Instagram reads) | Migration apply |
| AI personalised outreach (Haiku) | Yes (8 live calls, $0.007) | Provider limits |
| Gmail/Outlook sending, sequences, replies | Yes (tested with fake mailboxes and the real database) | Sections 3a–3d |
| Advisors ×8 | Yes; all portraits added | Provider limits and final integration qualification |
| SEO/GEO/AEO | Yes | Section 4 |
| Lead finder: local businesses, creators (Instagram/TikTok/YouTube) or your list; verified and ranked | Yes (18 offline + 5 web-search pricing checks; live: Berlin 10/10 with email; Instagram 9/9, TikTok 10/10, YouTube 7/7 verified; map fallback 10/10) | Keep web search enabled in the Claude Console (4b) |
| Help center with 15 guides and 10 animated demos | Yes | — |
