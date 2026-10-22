// Hard provider-spend cap for the whole Phase 1 baseline (runner + judge).
//
// Every paid call reserves its worst-case bound BEFORE it starts. A reservation
// that would take committed spend above the cap is refused, so the cap holds
// even if a run crashes mid-way: an unsettled reservation counts at its full
// bound until it is settled with a measured amount. The cap can be lowered
// with EVAL_CAP_USD but never raised above HARD_CAP_USD.
//
// Fail closed: a ledger that does not validate (missing or non-integer
// amounts, unknown statuses, a settled entry without a finite measured cost)
// stops every reserve/settle/summary/fits call instead of being read as $0; a
// missing ledger is only started fresh when no earlier paid work exists.
//
// Tests: EVAL_BUDGET_TEST_ROOT=<folder inside the OS temp dir> makes the module
// use <folder>/budget/ledger.json and look for paid-work evidence under
// <folder>/runs and <folder>/judge instead of outputs/eval. In that mode only
// reservations of kind "test" / "test-*" are accepted, so a real runner or
// judge call can never be booked against a throwaway ledger.
//   node scripts/eval/lib/budget.mjs --selftest     tamper + concurrency tests (temp folders only)
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { OUT, TRANSIENT_FS_CODES, ensureDir, readJson, rel, retryTransient, sleepSync, writeJson } from './paths.mjs';

// Hard cap history (each raise is an explicit owner approval, recorded in the
// ledger's capApprovals and checked by validateLedger):
// - $25.00: Phase 1 baseline (golden set, 18 October 2026).
// - $119.31 = $19.31 already settled + $100.00 new. "Kerim, chat 2026-10-20: +$100 Claude
//   test generation for design quality; +$2 OpenAI image research". The OpenAI part is
//   bounded separately by PROVIDER_CAPS_USD.openai ($0.053 settled before + $2.00 new),
//   independent of (and inside) the total cap.
// - $194.31 = $119.31 + $75.00 Claude for design round 3; OpenAI sub-cap $4.06 = $2.06 + $2.00.
//   "Kerim, chat 2026-10-21: +$75 Claude / +$2 OpenAI design round 3". The separate +$20 Claude /
//   +$3 OpenAI approved for product qualification is not part of this ledger.
// - $274.31 = $194.31 + $80.00 Claude: "Kerim, chat 2026-10-21: +$80 Claude concept step + app round" (OpenAI
//   sub-cap unchanged at $4.06). The ledger-wide total rises by the same $80 (from the qualification
//   allowance's $214.31 to $294.31); the record names both caps.
export const HARD_CAP_USD = 274.31;
export const CAP_APPROVAL = 'Kerim, chat 2026-10-21: +$80 Claude concept step + app round';
/** The design cap this raise starts from, and what it adds (also added to the ledger-wide total). */
export const PREVIOUS_DESIGN_CAP_USD = 194.31;
/** Per-provider sub-caps: a reservation must fit both the total cap and its provider's cap. */
export const PROVIDER_CAPS_USD = Object.freeze({ openai: 4.06 });
export const PROVIDERS = Object.freeze(['anthropic', 'openai']);
/** Entries before 2026-10-20 carry no provider: openai-* kinds were OpenAI image calls, everything else Anthropic. */
export const providerOf = entry => entry.provider ?? (/^openai-/.test(String(entry.kind)) ? 'openai' : 'anthropic');
export const PHASE = 'launch-quality-phase1-baseline-2026-10';
/** The approval record a ledger at this cap carries (written by --raise-cap and into fresh or rebuilt ledgers). */
export const CAP_APPROVAL_RECORD = Object.freeze({ capUsd: HARD_CAP_USD, previousCapUsd: PREVIOUS_DESIGN_CAP_USD, designCapUsd: HARD_CAP_USD, providerCapsUsd: PROVIDER_CAPS_USD, designProviderCapsUsd: PROVIDER_CAPS_USD, approval: CAP_APPROVAL });
/** This allowance's own approval record: designCapUsd/designProviderCapsUsd when the record also raised the ledger-wide total. */
const isDesignApproval = item => isPlainObject(item) && item.approval === CAP_APPROVAL && (item.designCapUsd ?? item.capUsd) === HARD_CAP_USD
  && JSON.stringify(item.designProviderCapsUsd ?? item.providerCapsUsd) === JSON.stringify(PROVIDER_CAPS_USD)
  // A record whose ledger-wide cap is the design cap itself carries the design provider caps there too.
  && (item.capUsd !== (item.designCapUsd ?? item.capUsd) || JSON.stringify(item.providerCapsUsd) === JSON.stringify(PROVIDER_CAPS_USD));
export const STATUSES = Object.freeze(['reserved', 'settled', 'unknown']);
/**
 * Shared ledger, separate allowances. Another approved allowance (e.g. Kerim's product-qualification
 * budget, scope "qualification-20261021") may raise ledger.hardCapUsd with its own capApprovals record
 * and write entries carrying `scope`. This module's own (design) spend is every entry WITHOUT a scope
 * (or with scope DESIGN_SCOPE) and stays within HARD_CAP_USD / PROVIDER_CAPS_USD; the ledger-wide total
 * stays within ledger.hardCapUsd and that record's provider caps. Entries of other scopes are never
 * rewritten here. Unscoped rows written by anyone count against the design cap (the safe side).
 */
export const DESIGN_SCOPE = 'design';
const isDesignEntry = entry => entry.scope === undefined || entry.scope === null || entry.scope === DESIGN_SCOPE;
const designLedger = ledger => ({ ...ledger, entries: ledger.entries.filter(isDesignEntry) });
/** The approval record for the ledger's current (possibly raised by another allowance) total cap. */
function ledgerApproval(ledger) {
  const records = Array.isArray(ledger.capApprovals) ? ledger.capApprovals.filter(item => isPlainObject(item) && item.capUsd === ledger.hardCapUsd) : [];
  return records[records.length - 1] ?? null;
}
const ledgerProviderCapUsd = (ledger, provider) => {
  const caps = ledgerApproval(ledger)?.providerCapsUsd;
  return isPlainObject(caps) && typeof caps[provider] === 'number' ? caps[provider] : PROVIDER_CAPS_USD[provider];
};
export const TEST_ROOT_ENV = 'EVAL_BUDGET_TEST_ROOT';
const TEST_KIND = /^test(?:-|$)/;
const LOCK_STALE_MS = 120_000;
const LOCK_WAIT_MS = 60_000;

export class CapReached extends Error {
  constructor(message, detail) { super(message); this.code = 'EVAL_CAP_REACHED'; this.detail = detail; }
}
/** The ledger is missing (with evidence of earlier paid work) or does not validate. */
export class LedgerError extends Error {
  constructor(message, code, detail) { super(message); this.code = code; this.detail = detail; }
}
/** A unique reservation (e.g. one runner brief) already has a ledger entry. */
export class DuplicateReservation extends Error {
  constructor(message, detail) { super(message); this.code = 'EVAL_DUPLICATE_RESERVATION'; this.detail = detail; }
}

export function capUsd(env = process.env) {
  const raw = env.EVAL_CAP_USD?.trim();
  if (!raw) return HARD_CAP_USD;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`EVAL_CAP_USD must be a positive number, got "${raw}"`);
  return Math.min(value, HARD_CAP_USD);
}

const micro = usd => Math.round(usd * 1e6);
const usd = microusd => microusd / 1e6;
const inside = (child, parent) => { const relative = path.relative(parent, child); return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative); };

/** Where the ledger and the paid-work evidence live (outputs/eval, or a temp test root). */
function where(env = process.env) {
  const raw = env[TEST_ROOT_ENV]?.trim();
  if (!raw) return { test: false, out: OUT, budget: path.join(OUT, 'budget') };
  const root = path.resolve(raw);
  const temp = path.resolve(os.tmpdir());
  if (!inside(root, temp)) throw new LedgerError(`${TEST_ROOT_ENV} must be a folder inside the OS temp directory; refusing ${root}`, 'EVAL_LEDGER_TEST_ROOT');
  if (root === OUT || inside(root, OUT) || inside(OUT, root)) throw new LedgerError(`${TEST_ROOT_ENV} must not overlap outputs/eval`, 'EVAL_LEDGER_TEST_ROOT');
  return { test: true, out: root, budget: path.join(root, 'budget') };
}

/** True when the module runs against a temp test ledger (live runs refuse this). */
export const isTestBudget = (env = process.env) => where(env).test;
export const ledgerFile = (env = process.env) => path.join(where(env).budget, 'ledger.json');
const display = file => (inside(file, OUT) ? rel(file) : file);

/** judge.mjs writes this into a round folder before its first paid reservation and never deletes it. */
export const JUDGE_LIVE_MARKER = 'live-started.json';
/** A verdicts.jsonl row (or any JSON line) recorded by a live call. */
const LIVE_MODE_LINE = /"mode"\s*:\s*"live"/;

/**
 * Evidence that paid calls already happened (an unreadable file counts too:
 * fail closed). Runs: any runs/live-* folder, any runs/<run>/approval.json
 * (only a live run writes one, before its first reservation) or a run.json
 * whose mode is live. Judge: any judge/live-* folder, a judge/<round>/
 * live-started.json marker, a verdicts.jsonl holding a "mode":"live" line, or a
 * summary.json whose mode is live. Renaming a folder, killing a round before
 * its summary.json, or re-running it dry under the same name (which rewrites
 * summary.json) therefore cannot hide earlier paid work.
 */
export function paidWorkEvidence(out = where().out) {
  const dirs = folder => {
    try { return readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const found = [];
  const modeOf = (file, label) => {
    if (!existsSync(file)) return;
    let value;
    try { value = retryTransient(() => readJson(file)); } catch { found.push(`${label} (unreadable)`); return; }
    if (value?.mode === 'live') found.push(`${label} (mode live)`);
  };
  for (const name of dirs(path.join(out, 'runs'))) {
    if (/^live-/i.test(name)) { found.push(`runs/${name}`); continue; }
    if (existsSync(path.join(out, 'runs', name, 'approval.json'))) { found.push(`runs/${name}/approval.json`); continue; }
    modeOf(path.join(out, 'runs', name, 'run.json'), `runs/${name}/run.json`);
  }
  // Every folder under judge/ (judge/ itself and nested ones, a few levels deep), not only
  // direct round folders: judge.mjs refuses nested or escaping --round names, and this scan
  // still finds evidence that an older or hand-made layout left in a sub-folder.
  const judgeRoot = path.join(out, 'judge');
  const visit = (round, label, depth) => {
    if (existsSync(path.join(round, JUDGE_LIVE_MARKER))) found.push(`${label}/${JUDGE_LIVE_MARKER}`);
    else {
      const verdicts = path.join(round, 'verdicts.jsonl');
      let live = false;
      if (existsSync(verdicts)) {
        let text = null;
        try { text = retryTransient(() => readFileSync(verdicts, 'utf8')); } catch { found.push(`${label}/verdicts.jsonl (unreadable)`); live = true; }
        if (text !== null && LIVE_MODE_LINE.test(text)) { found.push(`${label}/verdicts.jsonl (live call rows)`); live = true; }
      }
      if (!live) modeOf(path.join(round, 'summary.json'), `${label}/summary.json`);
    }
    if (depth >= 4) return;
    for (const name of dirs(round)) {
      if (/^live-/i.test(name)) found.push(`${label}/${name}`);
      visit(path.join(round, name), `${label}/${name}`, depth + 1);
    }
  };
  if (existsSync(judgeRoot)) visit(judgeRoot, 'judge', 0);
  return found;
}

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Every problem that makes a ledger unusable; [] when it is valid. */
export function validateLedger(ledger) {
  if (!isPlainObject(ledger)) return ['ledger is not a JSON object'];
  const problems = [];
  if (ledger.phase !== PHASE) problems.push(`ledger belongs to phase ${JSON.stringify(ledger.phase)}, not ${PHASE}; refusing to mix budgets`);
  if (ledger.schemaVersion !== 1) problems.push(`schemaVersion ${JSON.stringify(ledger.schemaVersion)} is not 1`);
  if (typeof ledger.hardCapUsd !== 'number' || !(ledger.hardCapUsd >= HARD_CAP_USD)) problems.push(`hardCapUsd ${JSON.stringify(ledger.hardCapUsd)} is below this allowance's ${HARD_CAP_USD}`);
  // A total above this allowance's cap needs its own recorded approval (another allowance's raise).
  else if (ledger.hardCapUsd !== HARD_CAP_USD && !ledgerApproval(ledger)?.approval) problems.push(`hardCapUsd ${ledger.hardCapUsd} has no capApprovals record`);
  // A raised cap is only valid with its recorded owner approval.
  if (HARD_CAP_USD > 25 && !(Array.isArray(ledger.capApprovals) && ledger.capApprovals.some(isDesignApproval))) problems.push(`capApprovals has no record approving the $${HARD_CAP_USD} cap and provider caps ${JSON.stringify(PROVIDER_CAPS_USD)}`);
  if (!Array.isArray(ledger.entries)) return [...problems, 'entries is not an array'];
  const ids = new Set();
  let total = 0;
  for (const [index, entry] of ledger.entries.entries()) {
    const at = `entries[${index}]`;
    if (!isPlainObject(entry)) { problems.push(`${at} is not an object`); continue; }
    if (typeof entry.id !== 'string' || !entry.id) problems.push(`${at}.id is missing`);
    else if (ids.has(entry.id)) problems.push(`${at}.id ${entry.id} is duplicated`);
    else ids.add(entry.id);
    if (typeof entry.kind !== 'string' || !entry.kind) problems.push(`${at}.kind is missing`);
    if (typeof entry.ref !== 'string') problems.push(`${at}.ref is not a string`);
    if (!Number.isSafeInteger(entry.boundMicrousd) || entry.boundMicrousd <= 0) problems.push(`${at}.boundMicrousd ${JSON.stringify(entry.boundMicrousd)} is not a positive safe integer`);
    if (!STATUSES.includes(entry.status)) problems.push(`${at}.status ${JSON.stringify(entry.status)} is not one of ${STATUSES.join('|')}`);
    if (entry.scope !== undefined && entry.scope !== null && (typeof entry.scope !== 'string' || !entry.scope)) problems.push(`${at}.scope ${JSON.stringify(entry.scope)} is not a non-empty string`);
    if (entry.provider !== undefined && !PROVIDERS.includes(entry.provider)) problems.push(`${at}.provider ${JSON.stringify(entry.provider)} is not one of ${PROVIDERS.join('|')}`);
    if (entry.status === 'settled') {
      if (!Number.isSafeInteger(entry.actualMicrousd) || entry.actualMicrousd < 0) problems.push(`${at} is settled but actualMicrousd ${JSON.stringify(entry.actualMicrousd)} is not a non-negative safe integer`);
    } else if (entry.actualMicrousd !== null && entry.actualMicrousd !== undefined) {
      problems.push(`${at} is ${entry.status} but carries actualMicrousd ${JSON.stringify(entry.actualMicrousd)}`);
    }
    const counted = entry.status === 'settled' ? entry.actualMicrousd : entry.boundMicrousd;
    if (Number.isSafeInteger(counted)) total += counted;
  }
  if (!Number.isSafeInteger(total)) problems.push('committed spend is not a safe integer');
  return problems;
}

/** Returned by readLedgerFile only when the file is absent (a file holding JSON `null` is NOT absent). */
const MISSING = Symbol('ledger missing');

/** Read the ledger file; MISSING only when it is absent on three reads in a row. */
function readLedgerFile(file) {
  for (let attempt = 1; ; attempt++) {
    try { return retryTransient(() => readJson(file)); } catch (error) {
      if (attempt < 3 && (error.code === 'ENOENT' || error instanceof SyntaxError)) { sleepSync(25 * attempt); continue; }
      if (error.code === 'ENOENT') return MISSING;
      if (error instanceof SyntaxError) throw new LedgerError(`Budget ledger ${display(file)} is not valid JSON; refusing to use it until it is repaired by hand`, 'EVAL_LEDGER_INVALID', { problems: ['not JSON'] });
      throw error;
    }
  }
}

function load(env = process.env) {
  const { out } = where(env);
  const file = ledgerFile(env);
  const ledger = readLedgerFile(file);
  // Only an absent file may start a fresh ledger; `null`, a number, a string or
  // an array in ledger.json is a damaged ledger and fails validation below.
  if (ledger === MISSING) {
    const evidence = paidWorkEvidence(out);
    if (evidence.length) {
      throw new LedgerError(`No budget ledger at ${display(file)}, but earlier paid work exists (${evidence.slice(0, 4).join(', ')}${evidence.length > 4 ? `, +${evidence.length - 4} more` : ''}). `
        + `Refusing to start a fresh $${HARD_CAP_USD} budget: restore ledger.json (or rebuild it from those runs' cost.json and the judge verdicts) before any paid call.`, 'EVAL_LEDGER_MISSING', { evidence });
    }
    return { schemaVersion: 1, phase: PHASE, hardCapUsd: HARD_CAP_USD, capApprovals: [CAP_APPROVAL_RECORD], entries: [] };
  }
  const problems = validateLedger(ledger);
  if (problems.length) {
    throw new LedgerError(`Budget ledger ${display(file)} is invalid (${problems.length} problem(s): ${problems.slice(0, 4).join('; ')}${problems.length > 4 ? '; …' : ''}). `
      + 'Refusing to reserve, settle or report spend until it is repaired by hand.', 'EVAL_LEDGER_INVALID', { problems });
  }
  return ledger;
}

/** Committed spend: settled entries at their measured cost, open or unknown ones at their bound. */
export function committedMicrousd(ledger) {
  return ledger.entries.reduce((sum, entry) => sum + (entry.status === 'settled' ? entry.actualMicrousd : entry.boundMicrousd), 0);
}
/** Committed spend of one provider (see providerOf). */
export function providerCommittedMicrousd(ledger, provider) {
  return committedMicrousd({ entries: ledger.entries.filter(entry => providerOf(entry) === provider) });
}

const pidAlive = pid => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};

/** Remove a lock left by a process that no longer exists (or one older than two minutes). */
function breakStaleLock(lock) {
  try {
    const age = Date.now() - statSync(lock).mtimeMs;
    let owner = null;
    try { owner = JSON.parse(readFileSync(lock, 'utf8')); } catch { /* being written, or empty */ }
    const stale = age > LOCK_STALE_MS || (owner ? !pidAlive(owner.pid) : age > 10_000);
    if (stale) unlinkSync(lock);
  } catch { /* raced with the owner or another waiter: just wait */ }
}

async function withLock(fn) {
  const lock = path.join(ensureDir(where().budget), 'ledger.lock');
  const started = Date.now();
  for (;;) {
    let fd;
    try {
      fd = openSync(lock, 'wx');
    } catch (error) {
      // EPERM/EBUSY/EACCES: the previous owner's lock file is still being deleted (Windows).
      if (error.code !== 'EEXIST' && !TRANSIENT_FS_CODES.includes(error.code)) throw error;
      if (error.code === 'EEXIST') breakStaleLock(lock);
      if (Date.now() - started > LOCK_WAIT_MS) throw new Error(`Budget ledger is locked by another process (waited ${LOCK_WAIT_MS / 1000} s)`);
      await new Promise(resolve => setTimeout(resolve, 15 + Math.random() * 45));
      continue;
    }
    try {
      try { writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); } finally { closeSync(fd); }
      return await fn();
    } finally {
      try { retryTransient(() => unlinkSync(lock)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

/**
 * Reserve a call's worst-case bound. Throws CapReached when it does not fit,
 * DuplicateReservation when `unique` and the same kind+ref already has an entry.
 * Returns the reservation id to settle later.
 */
export async function reserve({ kind, ref, boundUsd, note, unique = false, provider }) {
  if (typeof kind !== 'string' || !kind) throw new Error('A reservation needs a kind');
  const who = provider ?? providerOf({ kind });
  if (!PROVIDERS.includes(who)) throw new Error(`Unknown provider ${JSON.stringify(provider)}`);
  if (typeof ref !== 'string') throw new Error('A reservation needs a string ref');
  if (typeof boundUsd !== 'number' || !Number.isFinite(boundUsd) || !(boundUsd > 0)) throw new Error('A reservation needs a finite positive worst-case bound');
  const bound = micro(boundUsd);
  if (!Number.isSafeInteger(bound) || bound <= 0) throw new Error(`Bound $${boundUsd} is out of range`);
  if (isTestBudget() && !TEST_KIND.test(kind)) throw new Error(`${TEST_ROOT_ENV} is set (test ledger): refusing a real "${kind}" reservation`);
  return withLock(() => {
    const ledger = load();
    if (unique) {
      const prior = ledger.entries.filter(entry => entry.kind === kind && entry.ref === ref);
      if (prior.length) throw new DuplicateReservation(`${kind} ${ref} already has ${prior.length} ledger entr${prior.length === 1 ? 'y' : 'ies'} (${prior.map(entry => entry.status).join(', ')})`, { entries: prior.map(entry => ({ id: entry.id, status: entry.status })) });
    }
    const cap = micro(capUsd());
    const committed = committedMicrousd(designLedger(ledger));
    const ledgerCommitted = committedMicrousd(ledger);
    // The ledger-wide total (all allowances) never exceeds the ledger's own approved cap.
    if (!(ledgerCommitted + bound <= micro(ledger.hardCapUsd))) {
      throw new CapReached(`Ledger-wide cap reached: $${usd(ledgerCommitted).toFixed(2)} committed across allowances + $${boundUsd.toFixed(2)} bound for ${kind} ${ref} would exceed $${ledger.hardCapUsd.toFixed(2)}`,
        { committedUsd: usd(ledgerCommitted), boundUsd, capUsd: ledger.hardCapUsd });
    }
    // Written so that any NaN on either side refuses.
    if (!(committed + bound <= cap)) {
      throw new CapReached(`Spend cap reached: $${usd(committed).toFixed(2)} committed + $${boundUsd.toFixed(2)} bound for ${kind} ${ref} would exceed $${usd(cap).toFixed(2)}`,
        { committedUsd: usd(committed), boundUsd, capUsd: usd(cap) });
    }
    const ledgerProviderCap = ledgerProviderCapUsd(ledger, who);
    if (ledgerProviderCap !== undefined && !(providerCommittedMicrousd(ledger, who) + bound <= micro(ledgerProviderCap))) {
      throw new CapReached(`${who} ledger-wide cap reached: $${usd(providerCommittedMicrousd(ledger, who)).toFixed(4)} committed + $${boundUsd.toFixed(4)} bound would exceed $${ledgerProviderCap.toFixed(2)}`,
        { provider: who, committedUsd: usd(providerCommittedMicrousd(ledger, who)), boundUsd, capUsd: ledgerProviderCap });
    }
    const providerCap = PROVIDER_CAPS_USD[who];
    if (providerCap !== undefined) {
      const spent = providerCommittedMicrousd(designLedger(ledger), who);
      if (!(spent + bound <= micro(providerCap))) {
        throw new CapReached(`${who} spend cap reached: $${usd(spent).toFixed(4)} committed + $${boundUsd.toFixed(4)} bound for ${kind} ${ref} would exceed $${providerCap.toFixed(2)}`,
          { provider: who, committedUsd: usd(spent), boundUsd, capUsd: providerCap });
      }
    }
    const id = randomUUID();
    ledger.entries.push({ id, kind, ref, provider: who, note: note ?? null, boundMicrousd: bound, actualMicrousd: null, status: 'reserved', reservedAt: new Date().toISOString(), settledAt: null });
    writeJson(ledgerFile(), ledger);
    return id;
  });
}

/**
 * Settle with the measured cost. Only a finite, non-negative actualUsd settles;
 * `unknown`, or anything else (NaN, Infinity, negative, a string), keeps the
 * full bound counted (status unknown).
 */
export async function settle(id, { actualUsd, unknown = false, detail } = {}) {
  return withLock(() => {
    const ledger = load();
    const entry = ledger.entries.find(item => item.id === id);
    if (!entry) throw new Error(`No reservation ${id}`);
    if (entry.status !== 'reserved') throw new Error(`Reservation ${id} is already ${entry.status}`);
    const measured = !unknown && typeof actualUsd === 'number' && Number.isFinite(actualUsd) && actualUsd >= 0 ? micro(actualUsd) : null;
    if (measured === null || !Number.isSafeInteger(measured)) {
      entry.status = 'unknown';
      if (!unknown) entry.unknownReason = `actualUsd ${typeof actualUsd === 'number' ? String(actualUsd) : typeof actualUsd} is not a finite non-negative amount; the full bound stays counted`;
    } else {
      entry.status = 'settled'; entry.actualMicrousd = measured; entry.overrun = measured > entry.boundMicrousd;
    }
    entry.settledAt = new Date().toISOString();
    if (detail) entry.detail = detail;
    writeJson(ledgerFile(), ledger);
    return entry;
  });
}

/**
 * Write the (empty) ledger file before a live run or judge round creates its
 * first piece of paid-work evidence (its run folder, approval.json or
 * live-started.json); otherwise its own folder would make the first reserve()
 * refuse to start a ledger. No-op when a valid ledger exists; refuses like
 * load() when the ledger is missing but earlier paid work exists.
 */
export async function ensureLedger() {
  return withLock(() => {
    const file = ledgerFile();
    if (readLedgerFile(file) !== MISSING) { load(); return { created: false, file: display(file) }; }
    writeJson(file, load());
    return { created: true, file: display(file) };
  });
}

/**
 * Rebuild a MISSING ledger from the evidence on disk: every runs/<live run>/<item>/cost.json
 * (settled at its measured actualUsd, else unknown at its bound), every item folder of a live
 * run without cost.json (unknown at the website bound: something may have been spent), and
 * every live row of a judge verdicts.jsonl (settled at costUsd, else unknown at boundUsd).
 * Refuses when something cannot be reconstructed (a live judge marker without verdict rows,
 * an unreadable file) and never overwrites an existing ledger. Dry unless `write`.
 */
export async function rebuildLedger({ write = false, websiteBoundUsd = 1.8 } = {}) {
  const { out } = where();
  const run = () => {
    const file = ledgerFile();
    if (readLedgerFile(file) !== MISSING) throw new LedgerError(`${display(file)} exists; nothing to rebuild`, 'EVAL_LEDGER_EXISTS');
    const entries = [], sources = [], problems = [];
    const subdirs = folder => { try { return readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); } catch { return []; } };
    const json = file => { try { return retryTransient(() => readJson(file)); } catch { problems.push(`unreadable ${display(file)}`); return null; } };
    const entry = (kind, ref, boundUsd, actualUsd, note, id) => {
      const bound = micro(Number.isFinite(boundUsd) && boundUsd > 0 ? boundUsd : websiteBoundUsd);
      const settled = typeof actualUsd === 'number' && Number.isFinite(actualUsd) && actualUsd >= 0;
      entries.push({ id: typeof id === 'string' && id ? id : randomUUID(), kind, ref, note, boundMicrousd: bound, actualMicrousd: settled ? micro(actualUsd) : null,
        status: settled ? 'settled' : 'unknown', reservedAt: null, settledAt: null, rebuilt: true });
    };
    for (const name of subdirs(path.join(out, 'runs'))) {
      const runDir = path.join(out, 'runs', name);
      const runJson = existsSync(path.join(runDir, 'run.json')) ? json(path.join(runDir, 'run.json')) : null;
      const live = /^live-/i.test(name) || existsSync(path.join(runDir, 'approval.json')) || runJson?.mode === 'live';
      if (!live) continue;
      let items = 0;
      for (const item of subdirs(runDir)) {
        const costFile = path.join(runDir, item, 'cost.json');
        if (existsSync(costFile)) {
          const cost = json(costFile);
          if (cost) entry('runner', item, cost.boundUsd, cost.actualUsd, `rebuilt from runs/${name}/${item}/cost.json`, cost.reservationId);
        } else if (existsSync(path.join(runDir, item, 'item.json')) || existsSync(path.join(runDir, item, 'events'))) {
          entry('runner', item, websiteBoundUsd, null, `rebuilt: runs/${name}/${item} has no cost.json, counted at the full bound`);
        } else continue;
        items++;
      }
      sources.push(`runs/${name} (${items} item(s))`);
    }
    const judgeRoot = path.join(out, 'judge');
    const visit = (dir, label, depth) => {
      const verdicts = path.join(dir, 'verdicts.jsonl');
      let liveRows = 0;
      if (existsSync(verdicts)) {
        let text = '';
        try { text = retryTransient(() => readFileSync(verdicts, 'utf8')); } catch { problems.push(`unreadable ${label}/verdicts.jsonl`); }
        for (const line of text.split('\n').filter(Boolean)) {
          let row; try { row = JSON.parse(line); } catch { problems.push(`unparseable row in ${label}/verdicts.jsonl`); continue; }
          if (row?.mode !== 'live') continue;
          liveRows++;
          entry('judge', `${row.round ?? label}/${row.callId ?? liveRows}`, row.boundUsd, row.costUsd, `rebuilt from ${label}/verdicts.jsonl`);
        }
      }
      if (existsSync(path.join(dir, JUDGE_LIVE_MARKER)) && !liveRows) problems.push(`${label}/${JUDGE_LIVE_MARKER} exists but no live verdict rows were written: spend unknown, add entries by hand`);
      if (liveRows) sources.push(`${label} (${liveRows} live call(s))`);
      if (depth < 4) for (const name of subdirs(dir)) visit(path.join(dir, name), `${label}/${name}`, depth + 1);
    };
    if (existsSync(judgeRoot)) visit(judgeRoot, 'judge', 0);
    const ledger = { schemaVersion: 1, phase: PHASE, hardCapUsd: HARD_CAP_USD, capApprovals: [CAP_APPROVAL_RECORD], entries, rebuiltAt: new Date().toISOString(), rebuiltFrom: sources };
    const invalid = validateLedger(ledger);
    if (problems.length || invalid.length) throw new LedgerError(`Cannot rebuild the ledger: ${[...problems, ...invalid].join('; ')}`, 'EVAL_LEDGER_REBUILD', { problems: [...problems, ...invalid] });
    if (write) writeJson(file, ledger);
    return { written: write, file: display(file), sources, entries: entries.length, committedUsd: usd(committedMicrousd(ledger)) };
  };
  return write ? withLock(run) : run();
}

/**
 * One-time, owner-approved cap raise of the real ledger: sets hardCapUsd to HARD_CAP_USD and
 * appends CAP_APPROVAL_RECORD. Entries are never rewritten, reordered or removed; the ledger
 * must be valid under the previous cap first, and the new ledger must validate afterwards.
 */
export async function raiseCap({ write = false } = {}) {
  const run = () => {
    const file = ledgerFile();
    const ledger = readLedgerFile(file);
    if (ledger === MISSING) throw new LedgerError(`${display(file)} is missing; nothing to raise`, 'EVAL_LEDGER_MISSING');
    const ours = Array.isArray(ledger.capApprovals) && ledger.capApprovals.some(isDesignApproval);
    if (ours) { load(); return { written: false, already: true, file: display(file) }; }
    if (!(typeof ledger.hardCapUsd === 'number' && ledger.hardCapUsd >= PREVIOUS_DESIGN_CAP_USD)) throw new LedgerError(`hardCapUsd ${JSON.stringify(ledger.hardCapUsd)} is below the previous design cap ${PREVIOUS_DESIGN_CAP_USD}`, 'EVAL_LEDGER_INVALID');
    const before = JSON.stringify(ledger.entries);
    // The ledger-wide total rises by what this allowance adds; its provider caps (other allowances' included) are kept.
    const increment = Math.round((HARD_CAP_USD - PREVIOUS_DESIGN_CAP_USD) * 100) / 100;
    const wideCap = Math.round((ledger.hardCapUsd + increment) * 100) / 100;
    const wideProviderCaps = ledgerApproval(ledger)?.providerCapsUsd ?? PROVIDER_CAPS_USD;
    const record = { capUsd: wideCap, previousCapUsd: ledger.hardCapUsd, designCapUsd: HARD_CAP_USD, previousDesignCapUsd: PREVIOUS_DESIGN_CAP_USD,
      providerCapsUsd: wideProviderCaps, designProviderCapsUsd: PROVIDER_CAPS_USD, approval: CAP_APPROVAL, recordedAt: new Date().toISOString() };
    const raised = { ...ledger, hardCapUsd: wideCap, capApprovals: [...(Array.isArray(ledger.capApprovals) ? ledger.capApprovals : []), record] };
    const problems = validateLedger(raised);
    if (problems.length) throw new LedgerError(`Raised ledger would be invalid: ${problems.join('; ')}`, 'EVAL_LEDGER_INVALID', { problems });
    if (JSON.stringify(raised.entries) !== before) throw new Error('entries changed during the raise');
    if (write) writeJson(file, raised);
    return { written: write, file: display(file), ledgerWide: { fromUsd: ledger.hardCapUsd, toUsd: wideCap, providerCapsUsd: wideProviderCaps }, design: { fromUsd: PREVIOUS_DESIGN_CAP_USD, toUsd: HARD_CAP_USD, providerCapsUsd: PROVIDER_CAPS_USD }, entries: raised.entries.length, committedUsd: usd(committedMicrousd(raised)) };
  };
  return write ? withLock(run) : run();
}

/** Validated copies of the ledger entries, optionally filtered by kind and ref. */
export function ledgerEntries({ kind, ref } = {}) {
  return load().entries.filter(entry => (kind === undefined || entry.kind === kind) && (ref === undefined || entry.ref === ref)).map(entry => ({ ...entry }));
}

export function summary() {
  let ledger = load();
  const cap = micro(capUsd());
  const all = ledger;
  ledger = designLedger(ledger);
  const committed = committedMicrousd(ledger);
  const settled = ledger.entries.filter(entry => entry.status === 'settled');
  return {
    phase: PHASE,
    ...(isTestBudget() ? { testLedger: true } : {}),
    capUsd: usd(cap),
    committedUsd: usd(committed),
    remainingUsd: usd(Math.max(0, cap - committed)),
    settledUsd: usd(settled.reduce((sum, entry) => sum + entry.actualMicrousd, 0)),
    open: ledger.entries.filter(entry => entry.status === 'reserved').length,
    unknown: ledger.entries.filter(entry => entry.status === 'unknown').length,
    calls: ledger.entries.length,
    providerCapsUsd: PROVIDER_CAPS_USD,
    ledgerWide: { capUsd: all.hardCapUsd, committedUsd: usd(committedMicrousd(all)), otherScopes: [...new Set(all.entries.filter(entry => !isDesignEntry(entry)).map(entry => entry.scope))],
      providerCapsUsd: Object.fromEntries(PROVIDERS.map(provider => [provider, ledgerProviderCapUsd(all, provider) ?? null])), byProvider: Object.fromEntries(PROVIDERS.map(provider => [provider, usd(providerCommittedMicrousd(all, provider))])) },
    byProvider: Object.fromEntries(PROVIDERS.map(provider => [provider, usd(providerCommittedMicrousd(ledger, provider))])),
    byKind: Object.fromEntries([...new Set(ledger.entries.map(entry => entry.kind))].map(kind => [kind,
      usd(ledger.entries.filter(entry => entry.kind === kind).reduce((sum, entry) => sum + (entry.status === 'settled' ? entry.actualMicrousd : entry.boundMicrousd), 0))])),
  };
}

/** True when another call of this bound still fits under the cap (and its provider's cap). */
export function fits(boundUsd, provider = 'anthropic') {
  const ledger = load();
  if (typeof boundUsd !== 'number' || !Number.isFinite(boundUsd) || !(boundUsd > 0)) return false;
  const providerCap = PROVIDER_CAPS_USD[provider];
  const ledgerProviderCap = ledgerProviderCapUsd(ledger, provider);
  if (ledgerProviderCap !== undefined && !(providerCommittedMicrousd(ledger, provider) + micro(boundUsd) <= micro(ledgerProviderCap))) return false;
  if (!(committedMicrousd(ledger) + micro(boundUsd) <= micro(ledger.hardCapUsd))) return false;
  if (providerCap !== undefined && !(providerCommittedMicrousd(designLedger(ledger), provider) + micro(boundUsd) <= micro(providerCap))) return false;
  return committedMicrousd(designLedger(ledger)) + micro(boundUsd) <= micro(capUsd());
}

// ===========================================================================
// Scoped allowances (other owner approvals on the shared ledger)
// ===========================================================================
//
// A scoped allowance is a capApprovals record carrying `scope` and `allowance` { totalUsd, providerCapsUsd }
// that raised the ledger-wide hardCapUsd by totalUsd (e.g. scope "qualification-20261021"). Its entries carry
// the same `scope`; they never count against the design cap and are bounded by their own allowance
// (total and per provider; a provider the allowance does not list is refused) and by the ledger-wide caps.

const SCOPE_NAME = /^[a-z0-9][a-z0-9-]{2,63}$/;
const scopeEntries = (ledger, scope) => ledger.entries.filter(entry => entry.scope === scope);
/** The approval record of a scoped allowance, or null. */
export function scopeAllowance(ledger, scope) {
  const records = Array.isArray(ledger.capApprovals) ? ledger.capApprovals.filter(item => isPlainObject(item) && item.scope === scope && isPlainObject(item.allowance)) : [];
  const record = records.at(-1) ?? null;
  if (!record) return null;
  const { totalUsd, providerCapsUsd } = record.allowance;
  if (!(typeof totalUsd === 'number' && totalUsd > 0) || !isPlainObject(providerCapsUsd) || Object.entries(providerCapsUsd).some(([provider, cap]) => !PROVIDERS.includes(provider) || !(typeof cap === 'number' && cap >= 0))) return null;
  return record;
}

/**
 * Records an owner-approved scoped allowance once: appends its capApprovals record and raises the ledger-wide
 * cap by totalUsd. A ledger-wide provider cap rises by the allowance's cap for that provider (as the recorded
 * deck and docs allowances did: OpenAI +$2 and +$1.50); providers without a ledger-wide cap stay uncapped there
 * (an allowance limits its own providers through `allowance.providerCapsUsd`). Entries are never touched; the
 * result must validate. Dry unless `write`.
 */
export async function recordScopedAllowance({ scope, approval, totalUsd, providerCapsUsd, write = false }) {
  if (!SCOPE_NAME.test(String(scope)) || scope === DESIGN_SCOPE) throw new Error(`Invalid scope ${JSON.stringify(scope)}`);
  if (typeof approval !== 'string' || approval.trim().length < 10) throw new Error('A scoped allowance needs the owner approval text');
  if (!(typeof totalUsd === 'number' && Number.isFinite(totalUsd) && totalUsd > 0)) throw new Error('totalUsd must be a positive amount');
  if (!isPlainObject(providerCapsUsd) || !Object.keys(providerCapsUsd).length || Object.entries(providerCapsUsd).some(([provider, cap]) => !PROVIDERS.includes(provider) || !(typeof cap === 'number' && cap >= 0 && cap <= totalUsd)))
    throw new Error('providerCapsUsd must name known providers with caps between 0 and totalUsd');
  const run = () => {
    const file = ledgerFile();
    const ledger = load();
    const existing = scopeAllowance(ledger, scope);
    if (existing) return { written: false, already: true, file: display(file), record: existing };
    const before = JSON.stringify(ledger.entries);
    const wideCap = Math.round((ledger.hardCapUsd + totalUsd) * 100) / 100;
    const wideProviderCaps = Object.fromEntries(Object.entries(ledgerApproval(ledger)?.providerCapsUsd ?? PROVIDER_CAPS_USD)
      .map(([provider, cap]) => [provider, Math.round((cap + (providerCapsUsd[provider] ?? 0)) * 100) / 100]));
    const record = { capUsd: wideCap, previousCapUsd: ledger.hardCapUsd, providerCapsUsd: wideProviderCaps, approval, scope,
      allowance: { totalUsd, providerCapsUsd }, recordedAt: new Date().toISOString() };
    const raised = { ...ledger, hardCapUsd: wideCap, capApprovals: [...ledger.capApprovals, record] };
    const problems = validateLedger(raised);
    if (problems.length) throw new LedgerError(`Ledger with the scoped allowance would be invalid: ${problems.join('; ')}`, 'EVAL_LEDGER_INVALID', { problems });
    if (JSON.stringify(raised.entries) !== before) throw new Error('entries changed while recording the allowance');
    if (write) writeJson(file, raised);
    return { written: write, file: display(file), ledgerWide: { fromUsd: ledger.hardCapUsd, toUsd: wideCap }, record };
  };
  return write ? withLock(run) : run();
}

/** Spend of one scoped allowance: committed (settled at actuals, open/unknown at bounds) against its caps. */
export function scopeSummary(scope, ledger = load()) {
  const record = scopeAllowance(ledger, scope);
  if (!record) throw new LedgerError(`No approved allowance for scope ${JSON.stringify(scope)}`, 'EVAL_SCOPE_UNAPPROVED');
  const entries = scopeEntries(ledger, scope);
  const committed = committedMicrousd({ entries });
  return { scope, approval: record.approval, allowanceUsd: record.allowance.totalUsd, providerCapsUsd: record.allowance.providerCapsUsd,
    committedUsd: usd(committed), remainingUsd: usd(Math.max(0, micro(record.allowance.totalUsd) - committed)),
    settledUsd: usd(entries.filter(entry => entry.status === 'settled').reduce((sum, entry) => sum + entry.actualMicrousd, 0)),
    open: entries.filter(entry => entry.status === 'reserved').length, unknown: entries.filter(entry => entry.status === 'unknown').length, calls: entries.length,
    byProvider: Object.fromEntries(Object.keys(record.allowance.providerCapsUsd).map(provider => [provider, usd(committedMicrousd({ entries: entries.filter(entry => providerOf(entry) === provider) }))])),
    ledgerWide: { capUsd: ledger.hardCapUsd, committedUsd: usd(committedMicrousd(ledger)) } };
}

/** True when another call of this bound still fits the scoped allowance (total and provider) and the ledger-wide caps. */
export function fitsScoped(scope, boundUsd, provider = 'anthropic') {
  if (typeof boundUsd !== 'number' || !Number.isFinite(boundUsd) || !(boundUsd > 0)) return false;
  const ledger = load(), record = scopeAllowance(ledger, scope);
  if (!record || typeof record.allowance.providerCapsUsd[provider] !== 'number') return false;
  const entries = scopeEntries(ledger, scope), bound = micro(boundUsd);
  const wideProviderCap = ledgerProviderCapUsd(ledger, provider);
  return committedMicrousd(ledger) + bound <= micro(ledger.hardCapUsd)
    && (wideProviderCap === undefined || providerCommittedMicrousd(ledger, provider) + bound <= micro(wideProviderCap))
    && committedMicrousd({ entries }) + bound <= micro(record.allowance.totalUsd)
    && committedMicrousd({ entries: entries.filter(entry => providerOf(entry) === provider) }) + bound <= micro(record.allowance.providerCapsUsd[provider]);
}

/** Reserves a call's worst-case bound inside a scoped allowance (and the ledger-wide caps). Returns the reservation id. */
export async function reserveScoped({ scope, kind, ref, boundUsd, note, unique = false, provider = 'anthropic' }) {
  if (!SCOPE_NAME.test(String(scope)) || scope === DESIGN_SCOPE) throw new Error(`Invalid scope ${JSON.stringify(scope)}`);
  if (typeof kind !== 'string' || !kind) throw new Error('A reservation needs a kind');
  if (!PROVIDERS.includes(provider)) throw new Error(`Unknown provider ${JSON.stringify(provider)}`);
  if (typeof ref !== 'string') throw new Error('A reservation needs a string ref');
  if (typeof boundUsd !== 'number' || !Number.isFinite(boundUsd) || !(boundUsd > 0)) throw new Error('A reservation needs a finite positive worst-case bound');
  const bound = micro(boundUsd);
  if (isTestBudget() && !TEST_KIND.test(kind)) throw new Error(`${TEST_ROOT_ENV} is set (test ledger): refusing a real "${kind}" reservation`);
  return withLock(() => {
    const ledger = load();
    const record = scopeAllowance(ledger, scope);
    if (!record) throw new LedgerError(`No approved allowance for scope ${JSON.stringify(scope)}; refusing to reserve`, 'EVAL_SCOPE_UNAPPROVED');
    if (unique) {
      const prior = ledger.entries.filter(entry => entry.scope === scope && entry.kind === kind && entry.ref === ref);
      if (prior.length) throw new DuplicateReservation(`${scope} ${kind} ${ref} already has ${prior.length} ledger entr${prior.length === 1 ? 'y' : 'ies'}`, { entries: prior.map(entry => ({ id: entry.id, status: entry.status })) });
    }
    const entries = scopeEntries(ledger, scope);
    if (!(committedMicrousd(ledger) + bound <= micro(ledger.hardCapUsd))) throw new CapReached(`Ledger-wide cap reached: $${usd(committedMicrousd(ledger)).toFixed(2)} + $${boundUsd.toFixed(2)} would exceed $${ledger.hardCapUsd.toFixed(2)}`, { capUsd: ledger.hardCapUsd });
    const wideProviderCap = ledgerProviderCapUsd(ledger, provider);
    if (wideProviderCap !== undefined && !(providerCommittedMicrousd(ledger, provider) + bound <= micro(wideProviderCap))) throw new CapReached(`${provider} ledger-wide cap reached`, { provider, capUsd: wideProviderCap });
    if (!(committedMicrousd({ entries }) + bound <= micro(record.allowance.totalUsd))) throw new CapReached(`Scope ${scope} allowance reached: $${usd(committedMicrousd({ entries })).toFixed(4)} committed + $${boundUsd.toFixed(4)} would exceed $${record.allowance.totalUsd.toFixed(2)}`, { scope, capUsd: record.allowance.totalUsd });
    const providerCap = record.allowance.providerCapsUsd[provider];
    if (typeof providerCap !== 'number') throw new CapReached(`Scope ${scope} has no ${provider} allowance`, { scope, provider });
    const spent = committedMicrousd({ entries: entries.filter(entry => providerOf(entry) === provider) });
    if (!(spent + bound <= micro(providerCap))) throw new CapReached(`Scope ${scope} ${provider} allowance reached: $${usd(spent).toFixed(4)} + $${boundUsd.toFixed(4)} would exceed $${providerCap.toFixed(2)}`, { scope, provider, capUsd: providerCap });
    const id = randomUUID();
    ledger.entries.push({ id, kind, ref, provider, scope, note: note ?? null, boundMicrousd: bound, actualMicrousd: null, status: 'reserved', reservedAt: new Date().toISOString(), settledAt: null });
    writeJson(ledgerFile(), ledger);
    return id;
  });
}

// ===========================================================================
// Self-test (temp folders only; never touches outputs/eval/budget)
// ===========================================================================

const SELF = fileURLToPath(import.meta.url);

/** Child process of the concurrency test: wait for the start signal, then reserve or poll. */
async function selfTestChild([role, startFile, arg]) {
  while (!existsSync(startFile)) await new Promise(resolve => setTimeout(resolve, 5));
  if (role === 'reserve') {
    try {
      const id = await reserve({ kind: 'test-concurrency', ref: `pid-${process.pid}`, boundUsd: Number(arg) });
      process.stdout.write(JSON.stringify({ role, ok: true, id }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ role, ok: false, code: error.code ?? null, message: String(error.message).slice(0, 200) }));
    }
    return;
  }
  const until = Date.now() + Number(arg);
  let reads = 0;
  const errors = [];
  while (Date.now() < until) {
    try { summary(); fits(1.8); reads++; } catch (error) { errors.push(error.code ?? error.message); }
    await new Promise(resolve => setImmediate(resolve));
  }
  process.stdout.write(JSON.stringify({ role, reads, errors: errors.slice(0, 10), errorCount: errors.length }));
}

function runChild(args, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [SELF, '--selftest-child', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('close', code => {
      try { resolve({ code, ...JSON.parse(out) }); } catch { resolve({ code, ok: false, parseError: true, out: out.slice(0, 300), err: err.slice(0, 300) }); }
    });
  });
}

export async function selfTest({ processes = 32, readers = 4, boundUsd = 1.8, log = console.log } = {}) {
  const realLedger = path.join(OUT, 'budget', 'ledger.json');
  const realBefore = existsSync(realLedger) ? statSync(realLedger).mtimeMs : null;
  const base = mkdtempSync(path.join(os.tmpdir(), 'makeborne-budget-selftest-'));
  const savedEnv = { root: process.env[TEST_ROOT_ENV], cap: process.env.EVAL_CAP_USD };
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) }); log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 300)}`}`); };
  let n = 0;
  const fresh = () => { const root = path.join(base, `case-${++n}`); ensureDir(root); process.env[TEST_ROOT_ENV] = root; return root; };
  const writeLedger = (root, entries, extra = {}) => writeJson(path.join(root, 'budget', 'ledger.json'), { schemaVersion: 1, phase: PHASE, hardCapUsd: HARD_CAP_USD, capApprovals: [CAP_APPROVAL_RECORD], entries, ...extra });
  const entry = fields => ({ id: randomUUID(), kind: 'test', ref: 'x', note: null, boundMicrousd: 1_800_000, actualMicrousd: null, status: 'reserved', reservedAt: null, settledAt: null, ...fields });
  const refuses = async (fn, code) => { try { await fn(); return false; } catch (error) { return code ? error.code === code : true; } };
  const allRefuse = async code => (await refuses(() => summary(), code)) && (await refuses(() => fits(1), code)) && (await refuses(() => reserve({ kind: 'test', ref: 'r', boundUsd: 1 }), code));
  try {
    delete process.env.EVAL_CAP_USD;
    // Basic behaviour.
    fresh();
    const id = await reserve({ kind: 'test', ref: 'basic', boundUsd: 1 });
    check('reserve on a fresh test ledger', summary().committedUsd === 1 && summary().open === 1);
    await settle(id, { actualUsd: 0.4 });
    check('settle with a measured cost', summary().committedUsd === 0.4 && summary().settledUsd === 0.4);
    check('settle twice refused', await refuses(() => settle(id, { actualUsd: 0 })));

    // Settle with anything but a finite non-negative amount keeps the bound.
    for (const bad of [Infinity, NaN, -1, '1', null, undefined]) {
      fresh();
      const reservation = await reserve({ kind: 'test', ref: 'bad-settle', boundUsd: 2 });
      const settled = await settle(reservation, { actualUsd: bad });
      check(`settle(${typeof bad === 'string' ? JSON.stringify(bad) : String(bad)}) -> unknown at full bound`, settled.status === 'unknown' && summary().committedUsd === 2 && validateLedger(readJson(ledgerFile())).length === 0, { status: settled.status, committed: summary().committedUsd });
    }

    // Tampered ledgers refuse every operation.
    const tampered = {
      'entry without boundMicrousd': [entry({ boundMicrousd: undefined })],
      'non-numeric actualMicrousd on a settled entry': [entry({ status: 'settled', actualMicrousd: 'abc' })],
      'negative bound': [entry({ boundMicrousd: -24_000_000 })],
      'fractional bound': [entry({ boundMicrousd: 1.5 })],
      'settled with null actual (old Infinity settle)': [entry({ status: 'settled', actualMicrousd: null })],
      'settled with negative actual': [entry({ status: 'settled', actualMicrousd: -5 })],
      'unknown status': [entry({ status: 'void' })],
      'duplicate ids': (() => { const one = entry({}); return [one, { ...one }]; })(),
      'reserved entry with an actual': [entry({ actualMicrousd: 0 })],
    };
    for (const [name, entries] of Object.entries(tampered)) {
      const root = fresh();
      writeLedger(root, entries);
      check(`tamper: ${name} -> refused`, await allRefuse('EVAL_LEDGER_INVALID'));
    }
    for (const [name, extra] of Object.entries({ 'raised hardCapUsd': { hardCapUsd: 1000 }, 'cap raise without its approval record': { capApprovals: [] }, 'approval record with other provider caps': { capApprovals: [{ ...CAP_APPROVAL_RECORD, providerCapsUsd: { openai: 50 } }] }, 'old $25 ledger under the raised cap': { hardCapUsd: 25 }, 'other phase': { phase: 'other' }, 'entries not an array': { entries: {} } })) {
      const root = fresh();
      writeLedger(root, [], extra);
      check(`tamper: ${name} -> refused`, await allRefuse('EVAL_LEDGER_INVALID'));
    }
    { const root = fresh(); ensureDir(path.join(root, 'budget')); writeFileSync(path.join(root, 'budget', 'ledger.json'), '{"entries": ['); check('tamper: truncated JSON -> refused', await allRefuse('EVAL_LEDGER_INVALID')); }

    // A deleted ledger with evidence of earlier paid work is not recreated.
    { const root = fresh(); ensureDir(path.join(root, 'runs', 'live-20261018T000000Z')); check('deleted ledger + runs/live-* -> refused', await allRefuse('EVAL_LEDGER_MISSING')); check('...and no ledger was created', !existsSync(ledgerFile())); }
    { const root = fresh(); writeJson(path.join(root, 'judge', 'r1', 'summary.json'), { mode: 'live' }); check('deleted ledger + judge summary mode live -> refused', await allRefuse('EVAL_LEDGER_MISSING')); }
    { const root = fresh(); ensureDir(path.join(root, 'judge', 'live-20261018T000000Z')); check('deleted ledger + judge/live-* -> refused', await allRefuse('EVAL_LEDGER_MISSING')); }
    { const root = fresh(); writeJson(path.join(root, 'judge', 'dry-1', 'summary.json'), { mode: 'dry' }); ensureDir(path.join(root, 'runs', 'dry-1')); check('dry-only evidence -> fresh ledger allowed', (await refuses(() => reserve({ kind: 'test', ref: 'r', boundUsd: 1 }))) === false); }
    // A named judge round killed before its summary.json, or later re-run dry under the same name.
    const liveRow = JSON.stringify({ round: 'r1', callId: 'p-ab', mode: 'live', status: 'error' });
    { const root = fresh(); ensureDir(path.join(root, 'judge', 'r1')); writeFileSync(path.join(root, 'judge', 'r1', 'verdicts.jsonl'), `${liveRow}\n`); check('deleted ledger + named round killed before summary (live verdict row) -> refused', await allRefuse('EVAL_LEDGER_MISSING')); }
    { const root = fresh(); writeJson(path.join(root, 'judge', 'r1', 'summary.json'), { mode: 'dry' }); writeFileSync(path.join(root, 'judge', 'r1', 'verdicts.jsonl'), `${JSON.stringify({ mode: 'fake' })}\n${liveRow}\n`); check('deleted ledger + live round re-run dry (summary mode dry, live rows kept) -> refused', await allRefuse('EVAL_LEDGER_MISSING')); }
    { const root = fresh(); writeJson(path.join(root, 'judge', 'r1', JUDGE_LIVE_MARKER), { roundId: 'r1' }); writeJson(path.join(root, 'judge', 'r1', 'summary.json'), { mode: 'dry' }); check(`deleted ledger + judge ${JUDGE_LIVE_MARKER} (killed before its first verdict) -> refused`, await allRefuse('EVAL_LEDGER_MISSING')); }
    { const root = fresh(); writeJson(path.join(root, 'runs', 'renamed', 'approval.json'), { approval: 'x' }); check('deleted ledger + runs/<any>/approval.json (renamed live run) -> refused', await allRefuse('EVAL_LEDGER_MISSING')); }
    { const root = fresh(); writeJson(path.join(root, 'runs', 'renamed', 'run.json'), { mode: 'live' }); check('deleted ledger + runs/<any>/run.json mode live -> refused', await allRefuse('EVAL_LEDGER_MISSING')); }
    { const root = fresh(); ensureDir(path.join(root, 'judge', 'f1')); writeFileSync(path.join(root, 'judge', 'f1', 'verdicts.jsonl'), `${JSON.stringify({ mode: 'fake' })}\n`); writeJson(path.join(root, 'judge', 'f1', 'fake-started.json'), {}); writeJson(path.join(root, 'runs', 'dry-2', 'run.json'), { mode: 'dry' }); check('fake/dry-only rows and markers -> fresh ledger allowed', (await refuses(() => reserve({ kind: 'test', ref: 'r', boundUsd: 1 }))) === false); }
    // A ledger file holding JSON null (or any non-object) is damaged, not missing.
    for (const [name, text] of Object.entries({ null: 'null', number: '0', string: '"ledger"', array: '[]', 'true': 'true' })) {
      const root = fresh(); ensureDir(path.join(root, 'budget')); writeFileSync(path.join(root, 'budget', 'ledger.json'), text);
      check(`ledger.json holding ${name} -> invalid, not a fresh ledger`, await allRefuse('EVAL_LEDGER_INVALID') && readFileSync(path.join(root, 'budget', 'ledger.json'), 'utf8') === text);
    }

    // Cap: lower-only, and the comparison refuses at the cap.
    fresh();
    process.env.EVAL_CAP_USD = '1000'; check('EVAL_CAP_USD cannot raise the cap', capUsd() === HARD_CAP_USD && summary().capUsd === HARD_CAP_USD);
    process.env.EVAL_CAP_USD = '5'; check('EVAL_CAP_USD lowers the cap', summary().capUsd === 5);
    process.env.EVAL_CAP_USD = 'abc'; check('EVAL_CAP_USD garbage refused', await refuses(() => reserve({ kind: 'test', ref: 'r', boundUsd: 1 })));
    delete process.env.EVAL_CAP_USD;
    { const root = fresh(); writeLedger(root, [entry({ boundMicrousd: micro(HARD_CAP_USD) - 1_000_000 })]); check('reserve above the cap -> CapReached', await refuses(() => reserve({ kind: 'test', ref: 'over', boundUsd: 1.8 }), 'EVAL_CAP_REACHED') && fits(1.8) === false && fits(1) === true); }
    // Provider sub-cap (OpenAI images): refused on its own cap even with room under the total cap.
    { const root = fresh(); writeLedger(root, [entry({ kind: 'test', provider: 'openai', status: 'settled', actualMicrousd: micro(PROVIDER_CAPS_USD.openai) - 100_000, boundMicrousd: micro(PROVIDER_CAPS_USD.openai) - 100_000 })]);
      check('openai sub-cap: provider entries counted', Math.abs(summary().byProvider.openai - (PROVIDER_CAPS_USD.openai - 0.1)) < 1e-9);
      check('legacy entries: openai-* kinds are openai, others anthropic', providerOf({ kind: 'openai-image-qualification' }) === 'openai' && providerOf({ kind: 'runner' }) === 'anthropic');
      check('openai sub-cap: reservation over the provider cap -> CapReached', await refuses(() => reserve({ kind: 'test-image', ref: 'img', boundUsd: 0.2, provider: 'openai' }), 'EVAL_CAP_REACHED') && fits(0.2, 'openai') === false);
      check('openai sub-cap: a small one still fits', fits(0.05, 'openai') === true && (await refuses(() => reserve({ kind: 'test-image', ref: 'img-small', boundUsd: 0.05, provider: 'openai' }))) === false);
      check('openai sub-cap: anthropic spend is not limited by it', (await refuses(() => reserve({ kind: 'test-runner', ref: 'b', boundUsd: 5 }))) === false);
      check('unknown provider refused', await refuses(() => reserve({ kind: 'test', ref: 'p', boundUsd: 1, provider: 'other' }))); }
    // Shared ledger: another allowance raised the total cap (+$20, OpenAI +$3) and writes scoped rows.
    { const other = { capUsd: HARD_CAP_USD + 20, previousCapUsd: HARD_CAP_USD, providerCapsUsd: { openai: PROVIDER_CAPS_USD.openai + 3 }, approval: 'test: other allowance' };
      const raisedExtra = { hardCapUsd: HARD_CAP_USD + 20, capApprovals: [CAP_APPROVAL_RECORD, other] };
      const designAlmostFull = micro(HARD_CAP_USD) - 1_000_000;
      fresh(); writeLedger(process.env[TEST_ROOT_ENV], [entry({ kind: 'test', status: 'settled', actualMicrousd: designAlmostFull, boundMicrousd: designAlmostFull }), entry({ kind: 'test-q', scope: 'qualification-test', status: 'settled', actualMicrousd: 15_000_000, boundMicrousd: 15_000_000 })], raisedExtra);
      check('shared ledger: a raise by another allowance with its approval is valid', summary().ledgerWide.capUsd === HARD_CAP_USD + 20 && summary().ledgerWide.otherScopes.includes('qualification-test'));
      check('shared ledger: other-scope rows do not count against the design cap', Math.abs(summary().committedUsd - usd(designAlmostFull)) < 1e-9);
      check('shared ledger: design cap still binds although the ledger-wide cap has room', await refuses(() => reserve({ kind: 'test', ref: 'd', boundUsd: 1.5 }), 'EVAL_CAP_REACHED') && fits(1.5) === false && fits(0.5) === true);
      fresh(); writeLedger(process.env[TEST_ROOT_ENV], [entry({ kind: 'test', status: 'settled', actualMicrousd: 100_000_000, boundMicrousd: 100_000_000 }), entry({ kind: 'test-q', scope: 'qualification-test', status: 'settled', actualMicrousd: micro(HARD_CAP_USD + 20) - 100_500_000, boundMicrousd: micro(HARD_CAP_USD + 20) - 100_500_000 })], raisedExtra);
      check('shared ledger: the ledger-wide cap binds every allowance', await refuses(() => reserve({ kind: 'test', ref: 'w', boundUsd: 1 }), 'EVAL_CAP_REACHED') && fits(1) === false);
      fresh(); writeLedger(process.env[TEST_ROOT_ENV], [entry({ kind: 'test-q', scope: 'qualification-test', provider: 'openai', status: 'settled', actualMicrousd: 3_000_000, boundMicrousd: 3_000_000 })], raisedExtra);
      check('shared ledger: design OpenAI sub-cap counts design rows only', fits(PROVIDER_CAPS_USD.openai - 0.01, 'openai') === true && fits(PROVIDER_CAPS_USD.openai + 0.01, 'openai') === false);
      fresh(); writeLedger(process.env[TEST_ROOT_ENV], [], { hardCapUsd: HARD_CAP_USD + 20, capApprovals: [CAP_APPROVAL_RECORD] });
      check('shared ledger: a higher total cap without its own approval record is invalid', await refuses(() => reserve({ kind: 'test', ref: 'n', boundUsd: 1 }), 'EVAL_LEDGER_INVALID'));
      fresh(); writeLedger(process.env[TEST_ROOT_ENV], [], { hardCapUsd: HARD_CAP_USD - 1 });
      check('shared ledger: a total cap below this allowance is invalid', await refuses(() => reserve({ kind: 'test', ref: 'l', boundUsd: 1 }), 'EVAL_LEDGER_INVALID'));
      fresh(); writeLedger(process.env[TEST_ROOT_ENV], []); }
    // Scoped allowances: recorded once, raise the ledger-wide cap, bound their own entries, leave everything else alone.
    { const root = fresh(); const designRow = entry({ kind: 'test', status: 'settled', actualMicrousd: 2_000_000, boundMicrousd: 2_000_000 });
      writeLedger(root, [designRow]);
      const dry = await recordScopedAllowance({ scope: 'test-scope', approval: 'test: owner approved $5 Claude', totalUsd: 5, providerCapsUsd: { anthropic: 5 } });
      check('scoped allowance: dry run writes nothing', dry.written === false && readJson(path.join(root, 'budget', 'ledger.json')).hardCapUsd === HARD_CAP_USD);
      const recorded = await recordScopedAllowance({ scope: 'test-scope', approval: 'test: owner approved $5 Claude', totalUsd: 5, providerCapsUsd: { anthropic: 5 }, write: true });
      const after = readJson(path.join(root, 'budget', 'ledger.json'));
      check('scoped allowance: raises the ledger-wide cap by its total, keeps entries and the design record, validates', recorded.written && after.hardCapUsd === HARD_CAP_USD + 5 && validateLedger(after).length === 0
        && JSON.stringify(after.entries) === JSON.stringify([designRow]) && after.capApprovals.some(isDesignApproval));
      check('scoped allowance: recording it twice is a no-op', (await recordScopedAllowance({ scope: 'test-scope', approval: 'test: owner approved $5 Claude', totalUsd: 5, providerCapsUsd: { anthropic: 5 }, write: true })).already === true && readJson(path.join(root, 'budget', 'ledger.json')).hardCapUsd === HARD_CAP_USD + 5);
      const images = await recordScopedAllowance({ scope: 'test-images', approval: 'test: owner approved $1.50 Claude / $0.50 OpenAI', totalUsd: 2, providerCapsUsd: { anthropic: 1.5, openai: 0.5 }, write: true });
      const imagesLedger = readJson(path.join(root, 'budget', 'ledger.json'));
      check('scoped allowance: a ledger-wide provider cap rises by the allowance for that provider; others stay uncapped', images.written && imagesLedger.hardCapUsd === HARD_CAP_USD + 7
        && imagesLedger.capApprovals.at(-1).providerCapsUsd.openai === Math.round((PROVIDER_CAPS_USD.openai + 0.5) * 100) / 100 && imagesLedger.capApprovals.at(-1).providerCapsUsd.anthropic === undefined && validateLedger(imagesLedger).length === 0);
      const first = await reserveScoped({ scope: 'test-scope', kind: 'test-routing', ref: 'a', boundUsd: 3 });
      check('scoped reserve: a call inside the allowance is booked with its scope', ledgerEntries({ kind: 'test-routing' })[0]?.scope === 'test-scope' && Math.abs(scopeSummary('test-scope').committedUsd - 3) < 1e-9);
      check('scoped reserve: scoped rows never count against the design cap', Math.abs(summary().committedUsd - 2) < 1e-9);
      check('scoped reserve: an open reservation counts at its bound (no second $3)', await refuses(() => reserveScoped({ scope: 'test-scope', kind: 'test-routing', ref: 'b', boundUsd: 3 }), 'EVAL_CAP_REACHED'));
      await settle(first, { actualUsd: 1.25 });
      check('scoped settle: the measured cost frees the rest', Math.abs(scopeSummary('test-scope').remainingUsd - 3.75) < 1e-9 && (await refuses(() => reserveScoped({ scope: 'test-scope', kind: 'test-routing', ref: 'b', boundUsd: 3.5 }))) === false);
      check('scoped fits: agrees with reserveScoped', fitsScoped('test-scope', 0.25) === true && fitsScoped('test-scope', 0.5) === false && fitsScoped('test-scope', 0.01, 'openai') === false && fitsScoped('test-other', 0.01) === false);
      check('scoped reserve: the allowance total binds', await refuses(() => reserveScoped({ scope: 'test-scope', kind: 'test-routing', ref: 'c', boundUsd: 0.5 }), 'EVAL_CAP_REACHED'));
      check('scoped reserve: a provider the allowance does not list is refused', await refuses(() => reserveScoped({ scope: 'test-scope', kind: 'test-routing', ref: 'o', boundUsd: 0.01, provider: 'openai' }), 'EVAL_CAP_REACHED'));
      check('scoped reserve: an unapproved scope is refused', await refuses(() => reserveScoped({ scope: 'test-other', kind: 'test-routing', ref: 'x', boundUsd: 0.01 }), 'EVAL_SCOPE_UNAPPROVED'));
      check('scoped reserve: the design scope cannot be used', await refuses(() => reserveScoped({ scope: DESIGN_SCOPE, kind: 'test-routing', ref: 'x', boundUsd: 0.01 })));
      check('scoped reserve: test ledgers book test kinds only', await refuses(() => reserveScoped({ scope: 'test-scope', kind: 'routing-runner', ref: 'x', boundUsd: 0.01 }))); }
    check('non-finite bound refused', await refuses(() => reserve({ kind: 'test', ref: 'r', boundUsd: Infinity })) && await refuses(() => reserve({ kind: 'test', ref: 'r', boundUsd: NaN })) && fits(NaN) === false);

    // Test mode only books test kinds; unique reservations; root must be in temp.
    fresh();
    check('test ledger refuses kind runner/judge', await refuses(() => reserve({ kind: 'runner', ref: 'r', boundUsd: 1 })) && await refuses(() => reserve({ kind: 'judge', ref: 'r', boundUsd: 1 })));
    await reserve({ kind: 'test-runner', ref: 'brief-1', boundUsd: 1, unique: true });
    check('unique reservation refused the second time', await refuses(() => reserve({ kind: 'test-runner', ref: 'brief-1', boundUsd: 1, unique: true }), 'EVAL_DUPLICATE_RESERVATION'));
    check('ledgerEntries filters by kind and ref', ledgerEntries({ kind: 'test-runner', ref: 'brief-1' }).length === 1);
    process.env[TEST_ROOT_ENV] = path.join(OUT, 'budget-test'); check('test root inside outputs/eval refused', await refuses(() => summary(), 'EVAL_LEDGER_TEST_ROOT'));
    process.env[TEST_ROOT_ENV] = path.resolve(SELF, '..'); check('test root outside the temp dir refused', await refuses(() => summary(), 'EVAL_LEDGER_TEST_ROOT'));

    // Concurrency: N processes reserve at once while readers poll summary()/fits().
    const root = fresh();
    const startFile = path.join(root, 'go');
    // Children run under a $25 cap (EVAL_CAP_USD can only lower it), so the count stays below the process count.
    const env = { ...process.env, [TEST_ROOT_ENV]: root, EVAL_CAP_USD: '25' };
    const started = Date.now();
    const pending = [
      ...Array.from({ length: processes }, () => runChild(['reserve', startFile, String(boundUsd)], env)),
      ...Array.from({ length: readers }, () => runChild(['read', startFile, '6000'], env)),
    ];
    await new Promise(resolve => setTimeout(resolve, 1500)); // let every child start and wait on the signal
    writeFileSync(startFile, 'go');
    const results = await Promise.all(pending);
    const reservers = results.filter(result => result.role === 'reserve' || (result.parseError && !result.role));
    const okCount = reservers.filter(result => result.ok).length;
    const capped = reservers.filter(result => result.code === 'EVAL_CAP_REACHED').length;
    const other = reservers.filter(result => !result.ok && result.code !== 'EVAL_CAP_REACHED');
    const readerResults = results.filter(result => result.role === 'read');
    const expected = Math.floor(25 / boundUsd);
    process.env.EVAL_CAP_USD = '25';
    const final = summary();
    delete process.env.EVAL_CAP_USD;
    check(`concurrency: ${processes} reservers x $${boundUsd} -> exactly ${expected} succeed`, okCount === expected && capped === processes - expected && other.length === 0,
      { ok: okCount, capped, other: other.map(result => result.code ?? result.message ?? result.err).slice(0, 5) });
    check(`concurrency: ${readers} readers polled without errors`, readerResults.length === readers && readerResults.every(result => result.errorCount === 0),
      readerResults.map(result => ({ reads: result.reads, errors: result.errorCount, sample: result.errors })));
    check('concurrency: ledger consistent afterwards', final.calls === expected && Math.abs(final.committedUsd - expected * boundUsd) < 1e-9 && !existsSync(path.join(root, 'budget', 'ledger.lock'))
      && readdirSync(path.join(root, 'budget')).every(name => !name.endsWith('.tmp')), { calls: final.calls, committed: final.committedUsd, ms: Date.now() - started });
    log(`  concurrency: ${okCount} ok, ${capped} cap-reached, ${other.length} other errors; readers ${readerResults.map(result => result.reads).join('/')} reads; ${Date.now() - started} ms`);
  } finally {
    if (savedEnv.root === undefined) delete process.env[TEST_ROOT_ENV]; else process.env[TEST_ROOT_ENV] = savedEnv.root;
    if (savedEnv.cap === undefined) delete process.env.EVAL_CAP_USD; else process.env.EVAL_CAP_USD = savedEnv.cap;
    rmSync(base, { recursive: true, force: true });
  }
  const realAfter = existsSync(realLedger) ? statSync(realLedger).mtimeMs : null;
  check('real outputs/eval/budget/ledger.json untouched', realBefore === realAfter, { before: realBefore, after: realAfter });
  const failed = checks.filter(item => !item.ok);
  return { ok: failed.length === 0, checks: checks.length, failed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const [flag, ...rest] = process.argv.slice(2);
  if (flag === '--selftest-child') {
    selfTestChild(rest).then(() => { process.exitCode = 0; }, error => { process.stdout.write(JSON.stringify({ ok: false, message: String(error?.message ?? error) })); process.exitCode = 1; });
  } else if (flag === '--selftest') {
    console.log('budget.mjs self-test (temp folders only)');
    selfTest().then(result => { console.log(`\n${result.ok ? 'PASS' : 'FAIL'}: ${result.checks - result.failed.length}/${result.checks} checks`); process.exitCode = result.ok ? 0 : 1; },
      error => { console.error(error); process.exitCode = 1; });
  } else if (flag === '--rebuild') {
    const write = rest.includes('--write');
    rebuildLedger({ write }).then(result => { console.log(JSON.stringify(result, null, 2)); if (!write) console.log('Dry run: pass --write to create the ledger.'); },
      error => { console.error(error.message); process.exitCode = 1; });
  } else if (flag === '--raise-cap') {
    const write = rest.includes('--write');
    raiseCap({ write }).then(result => { console.log(JSON.stringify(result, null, 2)); if (!write && !result.already) console.log('Dry run: pass --write to record the raise.'); },
      error => { console.error(error.message); process.exitCode = 1; });
  } else if (flag === '--summary') {
    const scope = rest.includes('--scope') ? rest[rest.indexOf('--scope') + 1] : null;
    try { console.log(JSON.stringify(scope ? scopeSummary(scope) : summary(), null, 2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
  } else if (flag === '--record-scope') {
    // --record-scope <scope> --total <usd> --provider-cap <provider>=<usd> [...] --approval "<owner approval>" [--write]
    const value = name => rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined;
    const caps = Object.fromEntries(rest.flatMap((item, index) => item === '--provider-cap' ? [rest[index + 1].split('=')] : []).map(([provider, cap]) => [provider, Number(cap)]));
    recordScopedAllowance({ scope: rest[0], approval: value('--approval'), totalUsd: Number(value('--total')), providerCapsUsd: caps, write: rest.includes('--write') })
      .then(result => { console.log(JSON.stringify(result, null, 2)); if (!result.written && !result.already) console.log('Dry run: pass --write to record the allowance.'); }, error => { console.error(error.message); process.exitCode = 1; });
  } else {
    console.log('Usage: node scripts/eval/lib/budget.mjs --selftest | --summary [--scope <scope>] | --rebuild [--write] | --raise-cap [--write] | --record-scope <scope> --total <usd> --provider-cap <provider>=<usd> --approval "<text>" [--write]');
    process.exitCode = 2;
  }
}
