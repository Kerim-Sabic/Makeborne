// Is the server on 127.0.0.1:3210 the suite's own server? playwright.config.mjs
// reuses whatever already answers there (reuseExistingServer), so a stray
// `next dev` started from a plain shell would be tested instead: one that reads
// .env.local, talks to a cloud Supabase project and holds a provider key.
// Before any test (global-setup.mjs) and before any cleanup call
// (global-teardown.mjs) the server must prove it is the isolated one:
//   1. GET /login answers 2xx and its HTML names no supabase.co / supabase.in host;
//   2. the /login scripts carry the Supabase URL inlined at compile time, and it is
//      exactly the isolated stack (http://127.0.0.1:55435); no script carries a cloud
//      project URL (https://<20-char ref>.supabase.co|in; the SDK's own docs
//      mention https://xyzcompany.supabase.co, which is not a project);
//   3. GET /api/build answers {available: false, configured: false, state: "off"}: the live builder is off, so no
//      paid generation can start from this server (/api/build/plan and
//      /api/build/questions use the same switch);
//   4. GET /api/capabilities shows no Anthropic key: aiGeneration.configured is
//      false while cloudWorkspace.configured and publicPublishing.configured are
//      true. In src/lib/capabilities/snapshot.ts aiGeneration.configured is
//      cloud configured && ANTHROPIC_API_KEY set && server credential, and
//      publicPublishing.configured is cloud enabled && server credential, so with
//      those two true the only way to be false is a blank key. A server with the
//      builder off but a key present passed checks 1-3; this is what refuses it;
//   5. every route behind chatEnabled() (src/lib/experts/start.ts: expert chat,
//      the CRM follow-up and email drafts, the lead finder) answers 503
//      CHAT_UNAVAILABLE / FINDER_UNAVAILABLE. Sent only to a server that already
//      passed 1-4, see probeChatGated() for why the probe cannot start anything.
import { API as ISOLATED_SUPABASE_URL } from '../lib/stack.mjs';

// Placeholder ids for the dynamic segments. chatEnabled() runs before the ids are
// read, and nothing is ever looked up with them.
const PROBE_ID = '00000000-0000-4000-8000-000000000000';
export const CHAT_GATED = Object.freeze([
  { route: '/api/chat', code: 'CHAT_UNAVAILABLE' },
  { route: `/api/cloud/workspaces/${PROBE_ID}/clients/${PROBE_ID}/follow-up-draft`, code: 'CHAT_UNAVAILABLE' },
  { route: `/api/cloud/workspaces/${PROBE_ID}/leads/find`, code: 'FINDER_UNAVAILABLE' },
]);

const CLOUD_HOST = /supabase\.(?:co|in)\b/i;
const CLOUD_PROJECT = /https:\/\/[a-z0-9]{20}\.supabase\.(?:co|in)\b/g;
// Turbopack inlines `const url = ("TURBOPACK compile-time value", "<value>")`; webpack `const url = "<value>"`.
const CONFIGURED_URL = /function getSupabaseConfig\(\)\s*\{\s*const url\s*=\s*\(?\s*(?:"TURBOPACK compile-time value"\s*,\s*)?"([^"]*)"/g;
const mask = url => url.replace(/^(https:\/\/.{4}).*?(\.supabase\.)/, '$1…$2');

async function get(url, timeoutMs) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: '*/*' } });
  return { status: response.status, ok: response.ok, text: await response.text() };
}

const parse = text => { try { const body = JSON.parse(text); return body && typeof body === 'object' ? body : null; } catch { return null; } };

/**
 * Ask one chat-gated route whether chat is on, without anything that could start
 * a reply. The routes export only POST (a GET or OPTIONS never reaches the switch,
 * so it says nothing), and each runs sameOrigin() then chatEnabled() before it
 * reads the request.
 * The probe carries no cookie and no Authorization (Node's fetch keeps no cookie
 * jar; a reply needs a signed-in account with credits), no Origin header (so
 * sameOrigin() lets it through) and an empty text/plain body: with chat off the
 * route answers 503 <code>; with chat on, boundedJson() refuses the content type
 * with 415 before the body, the session, the database or a provider is touched.
 */
async function probeChatGated(origin, { route, code }, timeoutMs) {
  const response = await fetch(`${origin}${route}`, {
    method: 'POST', redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'text/plain', Accept: 'application/json' }, body: '',
  });
  const body = parse(await response.text());
  const answer = body?.error?.code ?? null;
  return { route, status: response.status, code: answer, unavailable: response.status === 503 && answer === code, expected: `503 ${code}` };
}

/**
 * Check the server's identity. Never throws for a mismatch; returns
 * {ok, problems: string[], facts}. Facts hold no secrets (URLs are masked).
 */
export async function checkServerIdentity(origin, { timeoutMs = 60_000 } = {}) {
  const problems = [];
  const facts = { origin, expectedSupabaseUrl: ISOLATED_SUPABASE_URL, loginStatus: null, scripts: 0, scriptsWithLocalUrl: 0, configuredUrls: [], cloudProjectUrls: [], build: null, capabilities: null, chatGated: [] };
  let login;
  try {
    login = await get(`${origin}/login`, timeoutMs);
    facts.loginStatus = login.status;
  } catch (error) {
    problems.push(`GET /login failed: ${error.cause?.code ?? error.name}: ${error.message}`);
    return { ok: false, problems, facts };
  }
  if (!login.ok) problems.push(`GET /login answered ${login.status}`);
  const named = login.text.match(CLOUD_HOST);
  if (named) problems.push(`the /login page names a cloud Supabase host ("${named[0]}")`);

  const scripts = [...login.text.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
    .map(match => new URL(match[1].replace(/&amp;/g, '&'), origin))
    .filter(url => url.origin === new URL(origin).origin && url.pathname.startsWith('/_next/'));
  facts.scripts = scripts.length;
  for (const url of scripts) {
    let body;
    try { body = (await get(url.href, timeoutMs)).text; } catch (error) { problems.push(`GET ${url.pathname} failed: ${error.message}`); continue; }
    if (body.includes(`"${ISOLATED_SUPABASE_URL}"`)) facts.scriptsWithLocalUrl++;
    for (const match of body.matchAll(CONFIGURED_URL)) facts.configuredUrls.push(CLOUD_HOST.test(match[1]) ? mask(match[1]) : match[1]);
    for (const match of body.matchAll(CLOUD_PROJECT)) facts.cloudProjectUrls.push(mask(match[0]));
  }
  facts.configuredUrls = [...new Set(facts.configuredUrls)];
  facts.cloudProjectUrls = [...new Set(facts.cloudProjectUrls)];
  if (!facts.scriptsWithLocalUrl) problems.push(`no /login script has the Supabase URL ${ISOLATED_SUPABASE_URL} inlined (${scripts.length} same-origin script(s) checked)`);
  const foreign = facts.configuredUrls.filter(url => url !== ISOLATED_SUPABASE_URL);
  if (foreign.length) problems.push(`the client is built for Supabase ${foreign.join(', ')}, not ${ISOLATED_SUPABASE_URL}`);
  if (facts.cloudProjectUrls.length) problems.push(`a /login script carries a cloud Supabase project URL (${facts.cloudProjectUrls.join(', ')})`);

  try {
    const build = await get(`${origin}/api/build`, timeoutMs);
    const body = parse(build.text);
    facts.build = { status: build.status, body: body ?? build.text.slice(0, 80) };
    if (!(build.ok && body && body.available === false && body.configured === false && body.state === 'off' && Object.keys(body).length === 3)) problems.push(`GET /api/build must answer {"available":false,"configured":false,"state":"off"} (builder off), got ${build.status} ${JSON.stringify(facts.build.body)}`);
  } catch (error) {
    problems.push(`GET /api/build failed: ${error.message}`);
  }

  try {
    const capabilities = await get(`${origin}/api/capabilities`, timeoutMs);
    const body = parse(capabilities.text);
    const seen = { aiGeneration: body?.aiGeneration?.configured, cloudWorkspace: body?.cloudWorkspace?.configured, publicPublishing: body?.publicPublishing?.configured };
    facts.capabilities = { status: capabilities.status, configured: seen };
    const shown = Object.entries(seen).map(([name, value]) => `${name}.configured=${value}`).join(', ');
    if (!capabilities.ok || typeof seen.aiGeneration !== 'boolean') problems.push(`GET /api/capabilities must answer the capability snapshot, got ${capabilities.status} ${capabilities.text.slice(0, 80)}`);
    else if (seen.aiGeneration) problems.push(`the server holds an Anthropic key: GET /api/capabilities answers ${shown}`);
    else if (seen.cloudWorkspace !== true || seen.publicPublishing !== true) problems.push(`GET /api/capabilities cannot show that the Anthropic key is blank (${shown}; aiGeneration.configured=false only proves it while the other two are true)`);
  } catch (error) {
    problems.push(`GET /api/capabilities failed: ${error.message}`);
  }

  if (problems.length) {
    // POSTs go only to a server already shown to be this app on the isolated stack with no key.
    facts.chatGated = CHAT_GATED.map(({ route }) => ({ route, skipped: 'not sent: the checks above already refuse this server' }));
    return { ok: false, problems, facts };
  }
  for (const target of CHAT_GATED) {
    try {
      const result = await probeChatGated(origin, target, timeoutMs);
      facts.chatGated.push(result);
      if (!result.unavailable) problems.push(`POST ${result.route} must answer ${result.expected} (chat and lead tools off), got ${result.status} ${result.code ?? '(no error code)'}`);
    } catch (error) {
      facts.chatGated.push({ route: target.route, error: error.message });
      problems.push(`POST ${target.route} (availability probe) failed: ${error.message}`);
    }
  }
  return { ok: !problems.length, problems, facts };
}

export function identityRefusal(origin, problems) {
  return [
    `Refusing to run the studio e2e suite against the server on ${origin}: it is not the suite's own server.`,
    ...problems.map(problem => `  - ${problem}`),
    'The suite only talks to scripts/eval/e2e/server.mjs (next dev on the isolated stack http://127.0.0.1:55435, provider keys blank).',
    `Playwright reuses whatever already answers on ${origin}, so stop that process and run again`
      + (process.platform === 'win32' ? ' (find it with: netstat -ano | findstr :3210, then taskkill /pid <pid> /T /F).' : ' (find it with: lsof -i :3210).'),
  ].join('\n');
}

/** Throws a clear refusal unless the server is the suite's own. */
export async function assertServerIdentity(origin, options) {
  const result = await checkServerIdentity(origin, options);
  if (!result.ok) {
    const error = new Error(identityRefusal(origin, result.problems));
    error.stack = error.message; // the message is the whole story; no stack in the report
    throw error;
  }
  return result;
}
