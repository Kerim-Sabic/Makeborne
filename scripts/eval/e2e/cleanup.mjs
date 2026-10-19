// What the funnel creates on the isolated stack, and how it is undone.
//
// Every object is written to a ledger in the OS temp folder the moment it
// exists (the review link before it is even requested), as one JSON line, and
// a "done" line is appended once it is cleaned up. Cleanup then runs from three
// places, so a review link never outlives the run that made it:
//   1. funnel.spec.mjs afterAll (the normal end of the funnel);
//   2. global-teardown.mjs (failed or interrupted runs, crashed workers);
//   3. global-setup.mjs of the next run, for ledgers whose run is over (a killed
//      run: no teardown ran, or the server was already down): the runner PID is
//      gone, or now belongs to a process with another start time (PID reuse), or
//      the ledger has been idle for 2 hours (see staleReason()).
// The app has no project delete: projects are renamed "[e2e] …" and archived.
// Review links are turned off, client comments resolved and the fixture
// project's delivery stage restored.
import path from 'node:path';
import { appendFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { ensureDir } from '../lib/paths.mjs';
import { ORIGIN, FIXTURE, RUN_STAMP, STAGE_DIR, signIn, appApi } from './helpers.mjs';

export const LEDGER_ROOT = path.dirname(STAGE_DIR);
export const LEDGER_FILE = path.join(STAGE_DIR, 'created.jsonl');
const ledgerName = 'created.jsonl';

export const routes = workspaceId => {
  const ws = `/api/cloud/workspaces/${workspaceId}`;
  return {
    workspace: ws,
    artifact: id => `${ws}/artifacts/${id}`,
    versions: id => `${ws}/artifacts/${id}/versions`,
    project: id => `${ws}/projects/${id}`,
    reviews: artifactId => `${ws}/artifacts/${artifactId}/reviews`,
    reviewLink: (artifactId, linkId) => `${ws}/artifacts/${artifactId}/reviews/${linkId}`,
    comment: id => `${ws}/review-comments/${id}`,
  };
};

// Created kinds, in the order they are undone (the bearer link first).
const ORDER = ['review-link', 'comment', 'fixture-stage', 'project'];
const refOf = entry => `${entry.kind}:${entry.kind === 'review-link' ? entry.recipientName : entry.commentId ?? entry.projectId}`;

/** Append one line to a ledger (synchronous: it must survive a kill right after). */
export function record(entry, file = LEDGER_FILE) {
  ensureDir(path.dirname(file));
  const line = { ...entry, at: new Date().toISOString() };
  if (ORDER.includes(entry.kind)) line.ref = refOf(entry);
  appendFileSync(file, JSON.stringify(line) + '\n');
  return line;
}

export const markDone = (ref, how, file = LEDGER_FILE) => record({ kind: 'done', ref, how }, file);

/**
 * The run line: who owns this ledger (stale detection) and which workspace it used.
 * `startedAt` is when the runner process started (Node's own clock, no spawn), so a
 * later sweep can tell the runner from an unrelated process that reuses its PID.
 */
export function startLedger() {
  const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
  return record({ kind: 'run', stamp: RUN_STAMP, pid: process.pid, startedAt, origin: ORIGIN, workspaceId: FIXTURE.workspaceId });
}

export function readLedger(file = LEDGER_FILE) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}

export const createdOf = entries => entries.filter(entry => ORDER.includes(entry.kind));

export function pendingOf(entries) {
  const done = new Set(entries.filter(entry => entry.kind === 'done').map(entry => entry.ref));
  const seen = new Set();
  return entries.filter(entry => ORDER.includes(entry.kind) && !done.has(entry.ref) && !seen.has(entry.ref) && seen.add(entry.ref));
}

export const pidAlive = pid => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};

// A whole suite run takes minutes; a ledger nobody wrote to for this long belongs
// to a dead or hung run, whatever its PID shows (PIDs are reused, on Windows soon).
export const STALE_IDLE_MS = 2 * 3_600_000;
// Two clocks for one process start: Node's (recorded) and the OS's (read back).
// Measured 17 ms apart on Windows; `ps -o etime=` has 1 s steps.
export const START_TOLERANCE_MS = 5_000;

/**
 * When the process with this PID started (ms since epoch), from the OS; null when
 * that cannot be read (no such process, access denied, no tool). Only called for
 * a ledger whose runner PID is alive and that is not idle yet, which is rare.
 */
export function processStartMs(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p -and $p.StartTime) { ([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds() }`],
      { encoding: 'utf8', timeout: 15_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      return /^\d+$/.test(out) ? Number(out) : null;
    }
    // [[dd-]hh:]mm:ss since the process started (procps and BSD ps alike).
    const out = execFileSync('ps', ['-o', 'etime=', '-p', String(pid)], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(out);
    if (!match) return null;
    const [, days = 0, hours = 0, minutes, seconds] = match.map(value => (value === undefined ? undefined : Number(value)));
    return Date.now() - (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
  } catch {
    return null;
  }
}

/**
 * Why the run that owns a ledger counts as over, or null while it may still run.
 * `isAlive` and `startOf` are injectable for the self-test.
 */
export function staleReason({ run, ended, idleMs }, { isAlive = pidAlive, startOf = processStartMs } = {}) {
  if (ended) return 'run ended';
  if (idleMs > STALE_IDLE_MS) return `idle ${Math.round(idleMs / 60_000)} min (> ${STALE_IDLE_MS / 3_600_000} h)`;
  if (!run) return null; // no run line: only the idle rule applies
  if (!isAlive(run.pid)) return 'runner process gone';
  const recorded = Date.parse(run.startedAt ?? '');
  if (Number.isNaN(recorded)) return null; // older ledger without startedAt: the idle rule decides
  const live = startOf(run.pid);
  if (live !== null && Math.abs(live - recorded) > START_TOLERANCE_MS) return `PID ${run.pid} now belongs to a process started ${new Date(live).toISOString()}, not the runner (${run.startedAt})`;
  return null;
}

/**
 * Ledgers of earlier runs that still hold pending items and whose run is over:
 * it ended, its runner process is gone, its PID now belongs to another process
 * (start time differs), or nothing was written to it for STALE_IDLE_MS.
 */
export function staleLedgers({ root = LEDGER_ROOT, current = RUN_STAMP, now = Date.now(), ...probes } = {}) {
  if (!existsSync(root)) return [];
  const stale = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === current) continue;
    const file = path.join(root, entry.name, ledgerName);
    if (!existsSync(file)) continue;
    const entries = readLedger(file);
    const pending = pendingOf(entries);
    if (!pending.length) continue;
    const run = entries.find(item => item.kind === 'run');
    const ended = entries.some(item => item.kind === 'run-end');
    const reason = staleReason({ run, ended, idleMs: now - statSync(file).mtimeMs }, probes);
    if (reason) stale.push({ file, stamp: run?.stamp ?? entry.name, pending: pending.length, reason });
  }
  return stale;
}

/**
 * Undo every pending item of one ledger through the app's own API.
 * `call(method, route, data)` -> {ok, status, body} as the signed-in owner.
 * Returns {cleaned, failed} and pushes one note per action into `notes`.
 */
export async function cleanPending({ call, file = LEDGER_FILE, notes = [] }) {
  const entries = readLedger(file);
  const run = entries.find(item => item.kind === 'run') ?? {};
  const stamp = run.stamp ?? path.basename(path.dirname(file));
  const api = routes(run.workspaceId ?? FIXTURE.workspaceId);
  const note = (action, result, extra = {}) => notes.push({ action, ok: result.ok, status: result.status, ...(result.ok ? {} : { code: result.body?.error?.code ?? null }), ...extra });
  const pending = pendingOf(entries).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  let cleaned = 0;
  for (const entry of pending) {
    let done = null;
    if (entry.kind === 'review-link') {
      // Found by recipient name, so a link whose id never reached the ledger is turned off too.
      const list = await call('GET', api.reviews(entry.artifactId));
      if (!list.ok) { note('list review links', list, { recipientName: entry.recipientName }); continue; }
      const mine = (list.body?.links ?? []).filter(link => link.recipientName === entry.recipientName);
      const failures = [];
      for (const link of mine.filter(item => !item.revokedAt)) {
        const revoked = await call('DELETE', api.reviewLink(entry.artifactId, link.id));
        note('turn off review link (API)', revoked, { linkId: link.id });
        if (!revoked.ok || !revoked.body?.link?.revokedAt) failures.push(link.id);
      }
      if (!failures.length) done = mine.length ? `${mine.length} link(s) off` : 'no link was created';
    } else if (entry.kind === 'comment') {
      const resolved = await call('PATCH', api.comment(entry.commentId), { resolved: true });
      note('resolve client comment', resolved, { commentId: entry.commentId });
      if (resolved.ok) done = 'resolved';
    } else if (entry.kind === 'fixture-stage') {
      const snapshot = await call('GET', api.workspace);
      const project = snapshot.body?.projects?.find(item => item.id === entry.projectId);
      if (!project) note('find fixture project', snapshot, { projectId: entry.projectId });
      else if (!entry.before || project.deliveryStage === entry.before) { notes.push({ action: 'restore fixture delivery stage', ok: true, unchanged: true }); done = 'unchanged'; } else {
        const restored = await call('PATCH', api.project(entry.projectId), { expectedUpdatedAt: project.updatedAt, deliveryStage: entry.before });
        note('restore fixture delivery stage', restored, { from: project.deliveryStage, to: entry.before });
        if (restored.ok) done = 'restored';
      }
    } else if (entry.kind === 'project') {
      const title = `[e2e] E2E funnel ${stamp} (${entry.step})`;
      const current = await call('GET', api.artifact(entry.artifactId));
      const version = current.body?.versions?.[0];
      if (current.ok && version && version.content?.title !== title) {
        const saved = await call('POST', api.versions(entry.artifactId), {
          expectedVersion: current.body.artifact.currentVersion, content: { ...version.content, title }, style: version.style,
          assetIds: version.assetIds ?? [], changeSummary: 'e2e cleanup: mark as a test project',
        });
        note('rename artifact', saved, { artifactId: entry.artifactId, title });
      } else if (!current.ok) note('read artifact', current, { artifactId: entry.artifactId });
      const snapshot = await call('GET', api.workspace);
      const project = snapshot.body?.projects?.find(item => item.id === entry.projectId);
      if (!project) note('find project', { ok: false, status: snapshot.status, body: snapshot.body }, { projectId: entry.projectId });
      else if (project.status === 'archived') { notes.push({ action: 'archive project', ok: true, projectId: entry.projectId, already: true }); done = 'already archived'; } else {
        const archived = await call('PATCH', api.project(entry.projectId), { expectedUpdatedAt: project.updatedAt, title, status: 'archived' });
        note('archive project', archived, { projectId: entry.projectId });
        if (archived.ok) done = 'archived';
      }
    }
    if (done) { markDone(entry.ref, done, file); cleaned++; }
  }
  return { file, stamp, pending: pending.length, cleaned, failed: pending.length - cleaned };
}

/** Sign in once in a fresh browser and clean several ledgers (teardown and the stale sweep). */
export async function cleanLedgers(files) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: ORIGIN });
    const page = await context.newPage();
    await signIn(page);
    const results = [];
    for (const file of files) {
      const notes = [];
      const result = await cleanPending({ call: (method, route, data) => appApi(page, method, route, data), file, notes });
      results.push({ ...result, notes });
    }
    return results;
  } finally {
    await browser.close();
  }
}
