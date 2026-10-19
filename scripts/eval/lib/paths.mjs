// Shared locations for the eval harness. Everything generated lands under
// outputs/eval/ (ignored by its own .gitignore); nothing here writes to src/.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';

export const EVAL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO = path.resolve(EVAL_DIR, '..', '..');
export const OUT = path.join(REPO, 'outputs', 'eval');
export const BRIEFS_DIR = path.join(EVAL_DIR, 'briefs');
export const RUNS = path.join(OUT, 'runs');
export const MEASURE = path.join(OUT, 'measure');
export const JUDGE = path.join(OUT, 'judge');
export const BUDGET = path.join(OUT, 'budget');
export const COMPETITORS = path.join(EVAL_DIR, 'competitors');

/**
 * ESLint lints outputs/ (it is not in the ignore list), so nothing written under
 * outputs/ may carry a lintable extension. Same rule as lib/website.mjs writeBuild().
 */
export const LINTABLE_EXTENSION = /\.(?:[cm]?[jt]sx?|[cm]ts)$/i;
export const isLintable = file => LINTABLE_EXTENSION.test(String(file));

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Windows reports a file another process has open (reader, indexer, AV scan) as EPERM/EBUSY/EACCES for a moment. */
export const TRANSIENT_FS_CODES = Object.freeze(['EPERM', 'EBUSY', 'EACCES']);
const sleeper = new Int32Array(new SharedArrayBuffer(4));
/** Synchronous sleep (writeJson and the ledger readers are synchronous). */
export const sleepSync = ms => { Atomics.wait(sleeper, 0, 0, Math.max(0, ms)); };

/**
 * Run a synchronous fs operation, retrying transient Windows sharing errors with
 * a short backoff (default 20 attempts over about 2 s). Other errors throw at once.
 */
export function retryTransient(fn, { attempts = 20, baseMs = 10, maxMs = 200, codes = TRANSIENT_FS_CODES } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return fn(); } catch (error) {
      if (!codes.includes(error?.code) || attempt >= attempts) throw error;
      sleepSync(Math.min(maxMs, baseMs * attempt) + Math.floor(Math.random() * baseMs));
    }
  }
}

export const readJson = file => JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));

/**
 * Write JSON atomically (temp file + rename) so a crash never leaves half a
 * ledger. On Windows the rename fails with EPERM/EBUSY/EACCES while another
 * process has the target open (e.g. a budget reader), so it is retried.
 */
export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  try {
    retryTransient(() => renameSync(temp, file));
  } catch (error) {
    try { unlinkSync(temp); } catch { /* already gone */ }
    throw error;
  }
}

export const exists = file => existsSync(file);

/** Paths are reported relative to the repo so reports carry no machine paths. */
export const rel = file => path.relative(REPO, file).split(path.sep).join('/');

export function stamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}
