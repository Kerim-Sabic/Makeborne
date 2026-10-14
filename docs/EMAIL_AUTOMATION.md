# Email automation (CRM)

Users connect their own Gmail or Outlook mailbox. Makeborne sends from it, runs multi-step follow-up sequences, detects replies, and records everything in the client's history. Replies land in the user's normal inbox.

**October14 launch path:** Gmail manual sending only (`MAKEBORNE_GOOGLE_MAIL_MODE=send_only`). This mode uses verified OpenID identity and provider-returned grants, requests no inbox access, stores an outgoing RFC Message-ID locally, and refuses Gmail automation/reply scans on the server. Incoming replies are handled in Gmail and CRM stages are updated manually. Outlook is deferred by the owner. The sequence/reply functionality below describes the later full-permission connector, not the send-only launch.

## What it does

- **Connect a mailbox:** OAuth for Gmail or Outlook. Tokens are encrypted with AES-256-GCM, bound to the mailbox row, and stored in `makeborne_private.mail_tokens`. Only service-role functions can reach them.
- **Send one email** from a client's Email tab:
  - `{{tokens}}` are filled from the client; a token with no value and no fallback blocks sending;
  - the email can be sent as a reply in the last thread;
  - it is logged as a contact, a Lead moves to Contacted, and the channel becomes Email.
- **Sequences:** up to 8 emails, days apart. Later emails without a subject are sent as replies in the same thread.
  - Add clients from the list (select them, then "Add to sequence") or from a client's Email tab.
  - A client can be in only one sequence at a time.
  - Pause, resume or stop per client.
  - A sequence stops automatically when the client replies, is marked Won or Lost, or loses their email address.
- **Reply detection:** threads Makeborne sent from are checked. A reply is recorded once and stops the sequence. The client moves to Conversation, a follow-up is set for today, and the reply appears in Recent replies.
  - There is no date cutoff, so older sequence threads are checked too. A tick inspects at most 200 sent-message rows and 60 unique threads per mailbox; an incomplete or failed check blocks that mailbox's automatic follow-ups. Other successfully checked mailboxes can continue. Busy mailboxes need bounded pagination or due-thread coverage before automation can scale beyond these limits; this package does not implement that progress mechanism.
- **Pace and deliverability:**
  - New mailboxes warm up at 10 per day for the first 3 days, 15 per day until day 7, then 5 more each day up to the mailbox's limit (default 50, adjustable).
  - Automatic sends are at least 2 minutes apart.
  - Emails are plain text, so they read as personal messages.
- **Safety:**
  - Each sequence step is claimed in the database before sending (unique on `enrollment_id, step`), so it can never go out twice.
  - A send whose outcome is unknown (timeout, provider 5xx) is marked "check your Sent folder" and never retried automatically.
  - A provider-accepted send followed by a receipt/history storage failure is also reported as uncertain, with a do-not-resend instruction. Saved provider identifiers are retained when possible.
  - Only the person who connected a mailbox can send from it. Reviewers can read but not send.

## Owner setup (one time)

Add these as secrets in the hosting environment. Never put them in the repo.

| Variable | Value |
|---|---|
| `MAKEBORNE_MAIL_ENCRYPTION_KEY` | 64 hex characters representing 32 random bytes. Back it up securely; replacing it without token re-encryption makes existing mailbox tokens unreadable. Use separate staging and production keys. |
| `MAKEBORNE_GOOGLE_MAIL_CLIENT_ID` / `_SECRET` | Google Cloud OAuth client (Web application) |
| `MAKEBORNE_GOOGLE_MAIL_MODE` | Explicitly `send_only` for this launch. Unset preserves legacy full mode; unknown nonempty values fail closed to sending only. |
| `MAKEBORNE_MICROSOFT_MAIL_CLIENT_ID` / `_SECRET` | Microsoft Entra app registration |
| `MAKEBORNE_MAIL_AUTOMATION_ENABLED` | `true` to let the scheduled job send sequences |

**Google**
1. In Google Cloud, enable the **Gmail API**.
2. On the OAuth consent screen, add `gmail.send`, `openid`, `email` and `profile`. Only a separately reviewed full-mode release may add `gmail.readonly`.
3. Create a Web OAuth client with the redirect URI `https://<app domain>/api/mail/callback/google`.
4. While the app is in "Testing" mode, only listed test users can connect.
5. **Public launch needs Google verification.** `gmail.send` is a *sensitive* scope (brand verification, a few days to weeks). `gmail.readonly` is a *restricted* scope: it requires a yearly third-party security assessment.
   - Sending-only is implemented and has26 offline mail groups plus12 callback checks. Token exchange must explicitly return the sending grant; refresh responses that omit scopes preserve the initially recorded grants. Legacy Google connections without recorded grants must reconnect. Live provider qualification remains open, including whether Gmail preserves our outgoing RFC Message-ID for replies within a sent thread.
   - Google's Testing status normally expires mail-scope refresh tokens after seven days. Use it for nominated test users, not as the public release configuration. See [Google OAuth token expiry](https://developers.google.com/identity/protocols/oauth2/) and [Gmail scope classification](https://developers.google.com/workspace/gmail/api/auth/scopes).

**Microsoft**
Deferred for first launch; leave its credentials unset until a separately qualified release.
1. Create an Entra app registration with the account type "Accounts in any organizational directory and personal Microsoft accounts".
2. Set the Web redirect URI to `https://<app domain>/api/mail/callback/microsoft`.
3. Add the delegated permissions `Mail.Send`, `Mail.ReadWrite`, `User.Read` and `offline_access`, and create a client secret.
4. Work accounts may need tenant admin consent.

**Schedule:** call `GET /api/cron/mail` every 10 minutes with `Authorization: Bearer $CRON_SECRET`, for example from Vercel Cron. It is not added to `vercel.json` until reviewed. Without the schedule, users can press **Check now** in Email.

Keep automation off for the sending-only launch. Current Vercel Hobby cannot run a ten-minute cron; Pro or a separately approved scheduler is needed when automation is qualified. **Check now** does not read Gmail replies in sending-only mode.

## Compliance notes (shown to users where relevant)

- B2B cold email rules differ by country. Germany expects prior consent; Canada's CASL applies; GDPR covers personal data in the EU.
- Every sequence stops on reply. Templates should invite a simple "no", and users must honour opt-outs.

## Files

- **Migrations:** `20261013240000_crm_email_automation.sql` creates the tables and initial token functions; `20261013250000_crm_lead_profile.sql` adds lead fields. Apply the additive `20261013260000_crm_mail_security_boundaries.sql` in the reviewed release too: private token authority, composite workspace references, flat tags and the missing lead-field update grants. The original migration files remain unchanged.
  - `20261013270000_mail_granted_scopes.sql` adds validated actual provider grants without inventing permissions for old accounts. Complete63-migration rehearsal passes136 SQL groups, five fault recoveries and two interruptions; no production apply is authorized.
- **Server:** `src/lib/mail/` contains `compose`, `throttle`, `config`, `providers`, `engine` and `server`.
- **Routes:**
  - `src/app/api/mail/connect`
  - `src/app/api/mail/callback/[provider]`
  - `src/app/api/cloud/workspaces/[ws]/mail/{,templates,sequences,enrollments,accounts,run}`
  - `src/app/api/cloud/workspaces/[ws]/clients/[id]/mail`
  - `src/app/api/cron/mail`
- **UI:** `src/components/mail/` contains the Email center, the client Email tab, the bulk enrol bar and the API helper.
- **Checks:**
  - `src/lib/mail/check-mail.cjs` runs26 offline groups in `npm test`, including DNS-pinned transport, send-outcome recovery, send-only capabilities and failed/incomplete reply-check safeguards. `check-mail-callback.cjs` adds12 mocked ownership/access/error groups.
  - The same file runs the engine against the isolated local database with `MAKEBORNE_VERIFY_MAIL_LOCAL=1`, adding 6 groups.
