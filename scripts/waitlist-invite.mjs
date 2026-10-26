// Launch waitlist invites. This repository has no transactional mail sender of its own (account emails go through
// Supabase's own mailer), so this script prepares the invite rather than sending it:
//
//   node scripts/waitlist-invite.mjs                      dry run (default): counts pending invites, prints the email copy; writes nothing
//   node scripts/waitlist-invite.mjs --export <file.csv>  writes each pending address with its sign-up link and signed unsubscribe links
//                                                         to a file outside the repo, plus the email copy; changes nothing in the database
//   node scripts/waitlist-invite.mjs --mark-invited <file.csv> --approval "<the owner's own words>"
//                                                         after the owner has sent the invites from their mail tool: marks exactly the
//                                                         exported rows invited (never unsubscribed ones)
//   --send                                                refused: there is no mail path to send through (see above)
//
// Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (service role) and MAKEBORNE_WAITLIST_SECRET (for unsubscribe links).
// MAKEBORNE_SITE_URL defaults to https://makeborne.com. Nothing here prints secrets; addresses go only into the CSV.
import { createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const INVITE_SUBJECT = "Makeborne is live. Your invite is here.";
export function inviteText({ signupUrl, unsubscribeUrl }) {
  return `Hi,

You joined the Makeborne waitlist, so here is your invite: Makeborne is live.

Create your account: ${signupUrl}

Makeborne turns a short brief into a real website, a designed book or a presentation, and keeps your client work in one place. Every request shows its credit limit before it starts.

If you make something you're proud of, reply and show us. We read every message.

The Makeborne team
makeborne.com · instagram.com/makeborne

You're getting this one email because you joined the launch waitlist at makeborne.com.
Unsubscribe: ${unsubscribeUrl}
`;
}

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const site = (process.env.MAKEBORNE_SITE_URL || "https://makeborne.com").replace(/\/$/, "");
const signupUrl = `${site}/login?mode=signup&utm_source=waitlist&utm_medium=email&utm_campaign=launch`;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function signedQuery(secret, id) {
  const sig = createHmac("sha256", secret).update("makeborne-waitlist:unsubscribe:").update(id.toLowerCase()).digest("hex");
  return `id=${encodeURIComponent(id)}&sig=${sig}`;
}
/** The link people click (a confirmation page, so mail scanners can't unsubscribe anyone). */
const unsubscribeUrl = (secret, id) => `${site}/waitlist/unsubscribe?${signedQuery(secret, id)}`;
/** RFC 8058 one-click target for the List-Unsubscribe header (POST only). */
const oneClickUrl = (secret, id) => `${site}/api/waitlist/unsubscribe?${signedQuery(secret, id)}`;
const csvCell = text => /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

async function rpc(name, body) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key?.startsWith("sb_secret_")) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (service role) for the target project.");
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${name} failed with HTTP ${response.status}`);
  return response.json();
}

async function main() {
  if (flag("--send")) {
    console.error("Refused: this repository has no transactional mail sender. Export a CSV with --export, send the invite from your mail tool, then run --mark-invited with --approval.");
    process.exit(2);
  }
  if (flag("--mark-invited")) {
    const file = value("--mark-invited"), approval = value("--approval");
    if (!file || !existsSync(file)) throw new Error("--mark-invited needs the CSV file that was exported and sent.");
    if (!approval || approval.trim().length < 8) throw new Error('--mark-invited needs --approval "<the owner\'s own words approving that these invites were sent>".');
    const ids = readFileSync(file, "utf8").split(/\r?\n/).slice(1).map(line => line.split(",").at(-1)?.trim()).filter(id => /^[0-9a-f-]{36}$/i.test(id ?? ""));
    if (!ids.length) throw new Error("No exported rows found in that file.");
    const marked = await rpc("makeborne_mark_launch_waitlist_invited", { p_ids: ids });
    console.log(`Marked ${marked} of ${ids.length} exported addresses invited. Approval recorded here only: "${approval.trim()}"`);
    return;
  }
  if (!flag("--export") && (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY)) {
    console.log(`Dry run without database settings: nothing counted.

Subject: ${INVITE_SUBJECT}

${inviteText({ signupUrl, unsubscribeUrl: `${site}/waitlist/unsubscribe?id=…&sig=…` })}`);
    return;
  }
  const pending = await rpc("makeborne_launch_waitlist_pending", { p_limit: 10000 });
  console.log(`${pending.length} waitlist address(es) not yet invited and not unsubscribed.`);
  if (flag("--export")) {
    const file = value("--export");
    if (!file) throw new Error("--export needs a file path.");
    const target = path.resolve(file);
    if (target.startsWith(repo + path.sep)) throw new Error("Write the export outside the repository; it contains personal data.");
    const secret = process.env.MAKEBORNE_WAITLIST_SECRET;
    if (!secret || secret.length < 32) throw new Error("Set MAKEBORNE_WAITLIST_SECRET (the production value) so unsubscribe links verify.");
    const lines = ["email,signup_url,unsubscribe_url,one_click_unsubscribe_url,id", ...pending.map(row => [row.email, signupUrl, unsubscribeUrl(secret, row.id), oneClickUrl(secret, row.id), row.id].map(csvCell).join(","))];
    writeFileSync(target, lines.join("\n") + "\n", { mode: 0o600 });
    writeFileSync(target.replace(/\.csv$/i, "") + ".email.txt", `Subject: ${INVITE_SUBJECT}\n\n${inviteText({ signupUrl, unsubscribeUrl: "{unsubscribe_url}" })}`);
    console.log(`Exported ${pending.length} row(s) to ${target} and the email copy beside it. Nothing was sent or marked.`);
    console.log("Where your mail tool allows, add the headers List-Unsubscribe: <{one_click_unsubscribe_url}> and List-Unsubscribe-Post: List-Unsubscribe=One-Click.");
    return;
  }
  console.log(`\nDry run. Subject: ${INVITE_SUBJECT}\n\n${inviteText({ signupUrl, unsubscribeUrl: `${site}/waitlist/unsubscribe?id=…&sig=…` })}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exit(1); });
}
