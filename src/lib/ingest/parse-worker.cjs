/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS so the same files load in a plain worker thread or sandbox without a build step. */
'use strict';
/* Worker-thread entry for source parsing (started by worker-host.ts).
 * Receives one file's bytes, returns one extraction object, then exits.
 * After the parsers load, module loading is switched off and network globals
 * are removed, so parser code cannot reach the file system, the network or
 * child processes through normal APIs. The host also gives this worker an
 * empty environment (no secrets), heap/stack limits and a wall-clock timeout.
 * A worker thread is not an OS sandbox: production runs the same files in the
 * sandbox pattern (no network, CPU/memory caps); see docs/AGENT_HANDOFF.md. */
const { parentPort } = require('node:worker_threads');
const { extract } = require('./parsers/core.cjs');
const Module = require('node:module');

Module._load = function blocked(request) { throw new Error(`Module loading is disabled in the source parser (${String(request).slice(0, 40)}).`); };
for (const key of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'Request', 'Response', 'Headers']) {
  try { delete globalThis[key]; } catch { /* Non-configurable in this runtime: still never called by the parsers. */ }
}
try { process.dlopen = () => { throw new Error('Native modules are disabled in the source parser.'); }; } catch { /* Read-only. */ }

parentPort.once('message', message => {
  let reply;
  try { reply = { ok: true, record: extract(message) }; }
  catch { reply = { ok: false }; }
  parentPort.postMessage(reply);
});
