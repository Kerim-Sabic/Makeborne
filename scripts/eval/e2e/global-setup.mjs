// Runs once, after Playwright's webServer step (which may have reused a server
// already on 3210) and before any test:
//   1. refuses to go on unless the server is the suite's own (identity.mjs);
//   2. opens this run's ledger of created objects (cleanup.mjs);
//   3. cleans what killed earlier runs left behind (their review links first).
import { ORIGIN } from './helpers.mjs';
import { assertServerIdentity } from './identity.mjs';
import { startLedger, staleLedgers, cleanLedgers, LEDGER_FILE } from './cleanup.mjs';

export default async function globalSetup() {
  const identity = await assertServerIdentity(ORIGIN);
  console.log(`[e2e setup] server on ${ORIGIN} confirmed: Supabase ${identity.facts.expectedSupabaseUrl} inlined in ${identity.facts.scriptsWithLocalUrl} of ${identity.facts.scripts} /login script(s), no cloud project URL, builder off, no Anthropic key, ${identity.facts.chatGated.length} chat-gated route(s) unavailable`);
  startLedger();
  console.log(`[e2e setup] created objects are recorded in ${LEDGER_FILE}`);
  const stale = staleLedgers();
  if (!stale.length) return;
  console.log(`[e2e setup] ${stale.length} earlier run(s) left ${stale.reduce((sum, item) => sum + item.pending, 0)} item(s) behind; cleaning them first`);
  for (const item of stale) console.log(`[e2e setup]   run ${item.stamp}: ${item.pending} pending, over because: ${item.reason}`);
  try {
    for (const result of await cleanLedgers(stale.map(item => item.file))) {
      console.log(`[e2e setup]   run ${result.stamp}: ${result.cleaned}/${result.pending} cleaned${result.failed ? ` (${result.failed} still pending in ${result.file})` : ''}`);
    }
  } catch (error) {
    // Not fatal for this run; the items stay pending and the next run tries again.
    console.warn(`[e2e setup] could not clean earlier runs: ${error.message.split('\n')[0]}`);
  }
}
