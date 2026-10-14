// Equivalent staging-only Resend rotation. Reads secrets from ignored files;
// never compares secrets with assert (which would print them on failure).
import fs from 'node:fs';
import os from 'node:os';
const ref = 'xzwikrunwpurxnxgkznh';
try {
  const token = fs.readFileSync(os.homedir() + '/.supabase/access-token', 'utf8').trim();
  const replacement = JSON.parse(fs.readFileSync('work/release-auth-stack/rotated-staging-resend.json', 'utf8'));
  if (!/^re_[A-Za-z0-9_-]+$/.test(replacement.key)) throw Error('Invalid replacement format');
  const url = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const before = await fetch(url, { headers });
  if (before.status !== 200) throw Error('Cannot read staging SMTP settings');
  const existing = await before.json();
  if (existing.smtp_host !== 'smtp.resend.com' || existing.smtp_user !== 'resend') throw Error('Unexpected staging SMTP configuration');
  const changed = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ smtp_pass: replacement.key }) });
  if (changed.status !== 200) throw Error('Staging SMTP update refused');
  // Management API masks/hashes smtp_pass on reads. Verify delivery separately.
  const localPath = 'work/release-auth-stack/staging-provider-credentials.json';
  const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
  if (typeof local.resend === 'string') local.resend = replacement.key;
  else if (local.resend && typeof local.resend === 'object') {
    for (const key of ['key', 'apiKey', 'api_key', 'smtp_pass']) if (key in local.resend) local.resend[key] = replacement.key;
  }
  fs.writeFileSync(localPath, JSON.stringify(local, null, 2));
  const result = { project: ref, productionTouched: false, updatedAt: new Date().toISOString(), keyName: replacement.name, smtpUpdateAccepted: true, deliveryVerified: false };
  fs.writeFileSync('docs/release-review/staging-smtp-rotation.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch {
  console.error('Staging SMTP rotation failed. Diagnostic values suppressed to protect credentials.');
  process.exitCode = 1;
}
