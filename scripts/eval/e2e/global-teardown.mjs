// Runs once at the end of every run, also after failures and Ctrl+C (before
// Playwright stops the webServer): whatever this run created and did not clean
// up yet (a crashed worker skips afterAll) is turned off or archived here.
// Writes outputs/eval/e2e/<stamp>/teardown.json. It only talks to a server
// that passes the identity check; otherwise the items stay in the ledger and
// the next run's global setup cleans them.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { writeJson } from '../lib/paths.mjs';
import { ORIGIN, RUN_DIR, RUN_STAMP } from './helpers.mjs';
import { checkServerIdentity } from './identity.mjs';
import { LEDGER_FILE, readLedger, pendingOf, createdOf, cleanLedgers, record } from './cleanup.mjs';

export default async function globalTeardown() {
  // No ledger: setup refused the server (or never ran), so this run created nothing.
  if (!existsSync(LEDGER_FILE)) return;
  const entries = readLedger(LEDGER_FILE);
  const pending = pendingOf(entries);
  // Reports carry no machine paths.
  const report = { at: new Date().toISOString(), ledger: `<os temp>/makeborne-e2e/${RUN_STAMP}/created.jsonl`, created: createdOf(entries).length, pendingBefore: pending.length, result: null };
  if (!pending.length) {
    console.log(`[e2e teardown] nothing left to clean (${report.created ? `${report.created} created object(s), all cleaned by the run` : 'this run created nothing'})`);
  } else {
    const identity = await checkServerIdentity(ORIGIN);
    if (!identity.ok) {
      report.result = { skipped: 'server identity not confirmed', problems: identity.problems };
      console.error(`[e2e teardown] ${pending.length} item(s) left in ${LEDGER_FILE}, but the server on ${ORIGIN} is not confirmed (${identity.problems[0]}); nothing was sent. The next run's global setup cleans them.`);
    } else {
      try {
        const [result] = await cleanLedgers([LEDGER_FILE]);
        report.result = { pending: result.pending, cleaned: result.cleaned, failed: result.failed, notes: result.notes };
        console.log(`[e2e teardown] cleaned ${result.cleaned}/${result.pending} item(s) this run left behind: ${pending.map(entry => entry.kind).join(', ')}${result.failed ? `; ${result.failed} still pending (the next run retries)` : ''}`);
      } catch (error) {
        report.result = { error: error.message.split('\n')[0] };
        console.error(`[e2e teardown] cleanup failed: ${report.result.error}; the items stay in ${LEDGER_FILE} and the next run's global setup retries`);
      }
    }
  }
  record({ kind: 'run-end' });
  report.pendingAfter = pendingOf(readLedger(LEDGER_FILE)).length;
  writeJson(path.join(RUN_DIR, 'teardown.json'), report);
}
