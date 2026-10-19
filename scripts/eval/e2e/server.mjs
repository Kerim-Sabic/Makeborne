// Local-only `next dev` for the studio e2e suite: 127.0.0.1:3210 against the
// isolated release-auth Supabase stack, with every provider, billing and cloud
// key blanked so no paid or external call can happen. Playwright starts it as
// its webServer (reuseExistingServer), or run it by hand:
//   node scripts/eval/e2e/server.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { REPO } from '../lib/paths.mjs';
import { isolatedStack } from '../lib/stack.mjs';

export const HOST = '127.0.0.1';
export const PORT = 3210;
export const ORIGIN = `http://${HOST}:${PORT}`;

// Inherited keys that could reach a provider, a payment system or a cloud
// project. An empty string (not a deleted key) is what stops Next from filling
// the key back in from .env.local: @next/env only loads keys that are undefined.
const BLANKED = /^(ANTHROPIC_|OPENAI_|WHOP_|SUPABASE_|NEXT_PUBLIC_SUPABASE_|MAKEBORNE_|VERCEL|CRON_SECRET|AWS_|RESEND_|GOOGLE_|GITHUB_|CLOUDFLARE_)/;
const PINNED_EMPTY = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'WHOP_API_KEY', 'WHOP_WEBHOOK_SECRET', 'MAKEBORNE_TRUSTED_PUBLICATION_ENABLED'];

// The files `next dev` loads (scripts/local-release-server.mjs does the same for
// `next start` with the production files). Every key named in them is blanked,
// whatever its prefix, so none of their values reaches the dev server; e2eEnv()
// then sets the few keys it needs on purpose.
export const ENV_FILES = Object.freeze(['.env', '.env.local', '.env.development', '.env.development.local']);
// The same two patterns as scripts/eval/run.mjs parseEnvText (copied, not
// imported: importing run.mjs would load the runner). DOTENV_LINE is dotenv's own
// LINE regex, verbatim as @next/env bundles it, so every name Next would load is
// found the way Next finds it: KEY=value, export KEY=value, KEY: value, names
// that start with a digit, dot or dash, `KEY` and `=value` split by a line break
// (its \s* crosses lines), and multi-line quoted values (their inner lines are
// values, not keys). KEY_ROW then adds any row that merely looks like a key
// (KEY:value, a key-like line inside a quoted value): blanking one key too many
// is harmless, missing one is not. selftest.mjs checks both against run.mjs.
const DOTENV_LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;
const KEY_ROW = /^\s*(?:export\s+)?([\w.-]+)\s*[=:]/;
// Never blanked even when a file names them: the OS and Node need them to start
// next at all, and a value the shell already has wins over any .env file anyway.
const OS_KEYS = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|HOMEDRIVE|HOMEPATH|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432)$/i;

/** Names (never values) one env file's text defines, exactly as run.mjs parseEnvText(text).names. */
export function envTextKeys(text) {
  const lines = String(text).replace(/\r\n?/gm, '\n');
  const names = new Set();
  for (const match of lines.matchAll(DOTENV_LINE)) names.add(match[1]);
  for (const row of lines.split('\n')) {
    const name = KEY_ROW.exec(row)?.[1];
    if (name) names.add(name);
  }
  return [...names];
}

/** Names (never values) of every key the env files `next dev` would load define. */
export function envFileKeys(dir = REPO) {
  const keys = new Set();
  for (const name of ENV_FILES) {
    const file = path.join(dir, name);
    if (!existsSync(file)) continue;
    for (const key of envTextKeys(readFileSync(file, 'utf8'))) keys.add(key);
  }
  return [...keys].filter(key => !OS_KEYS.test(key));
}

// Windows environment names are case-insensitive: drop every spelling before setting one.
function blank(env, key) {
  if (process.platform === 'win32') for (const name of Object.keys(env)) if (name !== key && name.toUpperCase() === key.toUpperCase()) delete env[name];
  env[key] = '';
}

/** The environment the e2e dev server runs with. Refuses any stack but the isolated one. */
export function e2eEnv(base = process.env, { fileKeys = envFileKeys() } = {}) {
  const stack = isolatedStack();
  const env = { ...base };
  for (const key of Object.keys(env)) if (BLANKED.test(key)) blank(env, key);
  for (const key of [...PINNED_EMPTY, ...fileKeys]) blank(env, key);
  return Object.assign(env, {
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    MAKEBORNE_LIVE_BUILDER_ENABLED: 'false',
    MAKEBORNE_CLOUD_ENABLED: 'true',
    MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED: 'true',
    MAKEBORNE_RELEASE_MAINTENANCE: 'off',
    NEXT_PUBLIC_SITE_URL: ORIGIN,
    NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: stack.publishableKey,
    SUPABASE_SECRET_KEY: stack.secretKey,
  });
}

/** Kill the whole tree: next dev forks workers that a plain kill leaves behind on Windows. */
export function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGTERM');
  } catch { /* already gone */ }
}

function start() {
  const fileKeys = envFileKeys();
  const env = e2eEnv(process.env, { fileKeys });
  // Presence only: never print a key's value.
  const present = ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'].filter(key => env[key]).join(', ');
  console.log(`[e2e server] next dev on ${ORIGIN} -> stack ${env.NEXT_PUBLIC_SUPABASE_URL} (set: ${present}; provider keys blank; ${fileKeys.length} key(s) named in ${ENV_FILES.join(', ')} blanked)`);
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', HOST, '--port', String(PORT)], {
    cwd: REPO, env, stdio: 'inherit', detached: process.platform !== 'win32',
  });
  let stopping = false;
  const stop = code => {
    if (stopping) return;
    stopping = true;
    killTree(child.pid);
    process.exit(code);
  };
  child.on('exit', code => { if (!stopping) process.exit(code ?? 1); });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, () => stop(0));
  process.on('exit', () => { if (!stopping) killTree(child.pid); });
}

// Only start when run directly, so helpers can import ORIGIN without side effects.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) start();
