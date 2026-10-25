/** Operator-only hardened Chromium for running a generated website from retained bytes.
 *
 * Same launch flags, environment allowlist and per-context lockdown as the
 * publication renderer (publication-renderer.mjs): an empty-ish environment, a dead
 * proxy plus `MAP * ~NOTFOUND` host resolution (nothing resolves, loopback included),
 * Chromium's sandbox, one renderer process, WebRTC constructors removed before any
 * project script, WebSockets refused, and every request either fulfilled from the
 * bytes the caller handed in or aborted. Nothing is ever `continue()`d to a network.
 *
 * The publication renderer keeps its own copy of this launch for now because its
 * bytes are part of a qualified renderer identity hash. At its next
 * requalification the renderer should adopt `launchIsolatedChromium()` and
 * `lockdownContext()` from this module (and include this file in its identity hash).
 *
 * In addition to the renderer's rules, this module adds an isolated enquiry sink:
 * a same-origin POST to /_mb/enquiries is answered locally with the customer-site
 * Worker's own contract (infra/customer-sites/forms.js) and recorded; it is never
 * forwarded. Any other non-GET, off-origin, socket, popup or download attempt is
 * aborted and recorded as a violation.
 *
 * Probes run in a CDP isolated world (`trustedWorld`), as the renderer does, so
 * project scripts cannot replace the DOM bindings or globals the verifier reads.
 * Never import this into request handlers. */
import {chromium} from 'playwright';
import {siteDocumentHeaders, siteDocumentPath, siteFileHeaders} from '../customer-sites/site-policy.js';

/** A fixed https test origin. `.invalid` can never resolve (RFC 2606), and the
 * resolver rule maps every host to NOTFOUND anyway: the origin exists only inside
 * the route handler below. https makes the page a secure context (crypto.randomUUID). */
export const VERIFIER_ORIGIN = 'https://site.makeborne-verifier.invalid';

/** Exactly the publication renderer's Chromium arguments. */
export const ISOLATED_CHROMIUM_ARGS = Object.freeze([
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--renderer-process-limit=1',
  '--js-flags=--max-old-space-size=128', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
  '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
]);
const ENV_ALLOWLIST = Object.freeze(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'LOCALAPPDATA']);
/** Chromium subprocesses receive no application/provider/database environment. */
export function isolatedChromiumEnv(source = process.env) {
  return Object.fromEntries(ENV_ALLOWLIST.filter(key => source[key]).map(key => [key, source[key]]));
}

/** Launch the hardened browser server and connect to it. `close()` always kills the server process. */
export async function launchIsolatedChromium({launchTimeoutMs = 10_000} = {}) {
  const server = await chromium.launchServer({headless: true, chromiumSandbox: true, env: isolatedChromiumEnv(), timeout: launchTimeoutMs, args: [...ISOLATED_CHROMIUM_ARGS]});
  let browser;
  try { browser = await chromium.connect(server.wsEndpoint(), {timeout: launchTimeoutMs}); }
  catch (error) { await server.kill(); throw error; }
  let closed = false;
  return {
    browser, version: browser.version(),
    async close() { if (closed) return; closed = true; await Promise.race([browser.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]); await server.kill(); },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** The customer-site Worker's enquiry contract (infra/customer-sites/forms.js submitEnquiry), answered locally:
 * same Origin, JSON, at most 10 000 bytes, only the allowed keys, an empty honeypot, a v1-8 UUID requestId and
 * the name/email/message limits. A valid payload gets the Worker's `{accepted: true}`; nothing is forwarded. */
export function enquiryContract({origin, headers, body}) {
  const reply = (status, message) => ({status, json: {error: {message}}});
  if (headers.origin !== origin) return reply(403, 'Submit the form from this website.');
  if ((headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json') return reply(415, 'Send JSON form data.');
  if (!body || body.length > 10_000) return reply(body ? 413 : 400, body ? 'The message is too long.' : 'Form data is missing.');
  let input;
  try { input = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(body)); } catch { return reply(400, 'Invalid form data.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['requestId', 'name', 'email', 'message', '_website'].includes(key)) || input._website) return reply(400, 'Invalid form data.');
  if (typeof input.requestId !== 'string' || !UUID.test(input.requestId)
    || typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.length > 120
    || typeof input.email !== 'string' || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)
    || typeof input.message !== 'string' || input.message.trim().length < 1 || input.message.length > 5000) return reply(400, 'Check your name, email and message.');
  return {status: 200, json: {accepted: true}};
}

/** A per-context record of everything the page asked the network for. */
export function createLedger() {
  return {requests: [], violations: [], enquiries: [], pageErrors: [], consoleErrors: [], blocked: [], bytes: 0};
}
const short = (value, max = 240) => String(value).slice(0, max);
const offOrigin = (url, origin) => { try { const parsed = new URL(url); return /^(?:https?|wss?|ftp):$/.test(parsed.protocol) && parsed.origin !== origin; } catch { return false; } };

/**
 * Lock a fresh context down to `site` served at `origin`: WebRTC denial, socket refusal, popup and download refusal,
 * and one route handler that fulfils documents and listed files from retained bytes, answers the enquiry sink, and
 * aborts everything else. Requests and violations are recorded in `ledger`.
 */
export async function lockdownContext(context, {site, origin = VERIFIER_ORIGIN, ledger = createLedger(), maxRequests = 512, maxBytes = 24_000_000}) {
  const address = new URL(origin);
  if (address.protocol !== 'https:' || address.origin !== origin || address.port || address.username || address.password) throw Error('ISOLATED_ORIGIN_INVALID');
  if (typeof site?.indexHtml !== 'string' || !Array.isArray(site.files)) throw Error('ISOLATED_SITE_INVALID');
  const fileMap = new Map(site.files.map(file => [file.path, file]));
  const indexBytes = Buffer.from(site.indexHtml);
  // WebRTC sockets are outside normal HTTP interception. Deny the constructors
  // before project execution in every frame, with non-replaceable properties.
  await context.addInitScript(() => { for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) Object.defineProperty(window, name, {value: undefined, writable: false, configurable: false}); });
  await context.routeWebSocket('**/*', socket => { ledger.violations.push({kind: 'websocket', url: short(socket.url())}); socket.close(); });
  context.on('page', page => {
    page.on('download', download => { ledger.violations.push({kind: 'download', url: short(download.url())}); void download.cancel(); });
  });
  let requests = 0;
  await context.route('**/*', async route => {
    const request = route.request(), method = request.method(), type = request.resourceType();
    let url;
    try { url = new URL(request.url()); } catch { ledger.violations.push({kind: 'invalid-url', url: short(request.url())}); await route.abort(); return; }
    const entry = {method, url: short(url.href), type, outcome: 'aborted', reason: ''};
    ledger.requests.push(entry);
    const abort = async (reason, violation) => {
      entry.reason = reason;
      if (violation) ledger.violations.push({kind: violation, method, url: entry.url, type});
      await route.abort('blockedbyclient');
    };
    if (++requests > maxRequests) return abort('request-budget', 'request-budget');
    if (url.origin !== origin) return abort('off-origin', 'off-origin');
    const fulfil = async (status, headers, body, outcome = 'fulfilled') => {
      ledger.bytes += body.length;
      if (ledger.bytes > maxBytes) return abort('byte-budget', 'byte-budget');
      entry.outcome = outcome; entry.status = status;
      await route.fulfill({status, headers, body});
    };
    if (url.pathname === '/_mb/enquiries' && method === 'POST') {
      const body = request.postDataBuffer() ?? null, headers = request.headers();
      const answer = enquiryContract({origin, headers, body});
      let parsed = null;
      try { parsed = body ? JSON.parse(body.toString('utf8')) : null; } catch { parsed = short(body?.toString('utf8') ?? '', 400); }
      ledger.enquiries.push({at: Date.now(), status: answer.status, contentType: short(headers['content-type'] ?? '', 80), navigation: request.isNavigationRequest(), body: parsed, response: answer.json});
      return fulfil(answer.status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}, Buffer.from(JSON.stringify(answer.json)), 'sink');
    }
    if (method !== 'GET') return abort('non-get', 'non-get');
    if (request.isNavigationRequest()) {
      // Main-frame documents only: frames are refused by the site CSP (frame-src 'none') and here.
      if (request.frame() !== request.frame().page()?.mainFrame()) return abort('frame', 'frame');
      if (type === 'document' && siteDocumentPath(url.pathname) && !fileMap.has(url.pathname)) return fulfil(200, siteDocumentHeaders({interactive: true, secure: true, indexable: false}), indexBytes);
    }
    const file = !url.search ? fileMap.get(url.pathname) : null;
    if (!file) return abort('unlisted');
    return fulfil(200, siteFileHeaders({pathname: file.path, contentType: file.contentType, secure: true}), file.body);
  });
  return ledger;
}

/** A new locked-down context and page for `site`, with page errors, console errors and CSP blocks recorded. */
export async function openSiteContext(browser, {site, origin = VERIFIER_ORIGIN, viewport, reducedMotion = 'no-preference', maxRequests, maxBytes}) {
  const context = await browser.newContext({viewport, serviceWorkers: 'block', acceptDownloads: false, javaScriptEnabled: true, reducedMotion, permissions: [], locale: 'en-GB', timezoneId: 'UTC', colorScheme: 'light'});
  const ledger = createLedger();
  try {
    await lockdownContext(context, {site, origin, ledger, maxRequests, maxBytes});
    const page = await context.newPage();
    context.on('page', popup => { if (popup !== page) { ledger.violations.push({kind: 'popup', url: short(popup.url())}); void popup.close(); } });
    page.on('pageerror', error => ledger.pageErrors.push(short(error?.message ?? error, 400)));
    // ERR_BLOCKED_BY_CLIENT is the browser's echo of this module's own aborts (already in ledger.requests).
    const ownAbort = text => /net::ERR_BLOCKED_BY_CLIENT/.test(text);
    page.on('console', message => { if (message.type() === 'error' && !ownAbort(message.text())) ledger.consoleErrors.push(short(message.text(), 400)); });
    // Browser-side blocks (CSP connect-src/img-src/form-action) never reach the route handler: read them from CDP.
    const cdp = await context.newCDPSession(page);
    const urls = new Map();
    cdp.on('Network.requestWillBeSent', event => urls.set(event.requestId, event.request.url));
    cdp.on('Network.loadingFailed', event => {
      if (!event.blockedReason || event.blockedReason === 'inspector') return;
      const url = urls.get(event.requestId) ?? '';
      // Requests the route handler aborted are already in the ledger.
      if (ledger.requests.some(item => item.url === short(url) && item.outcome === 'aborted')) return;
      ledger.blocked.push({reason: event.blockedReason, url: short(url)});
      if (offOrigin(url, origin)) ledger.violations.push({kind: 'off-origin', url: short(url), blockedBy: event.blockedReason});
    });
    cdp.on('Log.entryAdded', ({entry}) => {
      if (entry.level !== 'error' || ownAbort(entry.text)) return;
      const text = short(entry.text, 400);
      if (!ledger.consoleErrors.includes(text)) ledger.consoleErrors.push(text);
      // "Connecting to 'https://x/' violates the following Content Security Policy directive..." (older: "Refused to connect to 'https://x/'").
      const target = /'((?:https?|wss?):\/\/[^']+)'/.exec(entry.text)?.[1] ?? /\b(?:load|connect to) ((?:https?|wss?):\/\/[^\s'"]+?)(?:\.\s|\.?$|\s)/.exec(entry.text)?.[1];
      if (target && /Content Security Policy/.test(entry.text) && offOrigin(target, origin) && !ledger.violations.some(item => item.url === short(target))) ledger.violations.push({kind: 'off-origin', url: short(target), blockedBy: 'csp'});
    });
    await cdp.send('Network.enable');
    await cdp.send('Log.enable');
    return {context, page, cdp, ledger, async close() { await Promise.race([context.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]); }};
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

const withTimeout = (promise, ms, code) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error(code), {code})), ms); })]).finally(() => clearTimeout(timer));
};

/**
 * Evaluate probe functions in a CDP isolated world of the page's main frame. Isolated-world DOM bindings and globals
 * cannot be replaced by project scripts, so neither patched prototypes nor app-defined globals can forge a result.
 * `prelude` (a self-contained function) runs before every probe; `fn` receives one JSON argument and must be
 * self-contained. The world is re-created after a cross-document navigation (its references are then gone).
 */
export function trustedWorld(page, cdp, {prelude = null, worldName = 'makeborne-site-verifier'} = {}) {
  let contextId = null;
  const create = async () => {
    const {frameTree} = await cdp.send('Page.getFrameTree');
    const {executionContextId} = await cdp.send('Page.createIsolatedWorld', {frameId: frameTree.frame.id, worldName, grantUniveralAccess: false});
    contextId = executionContextId;
  };
  return {
    async run(fn, arg = null, {timeoutMs = 8000} = {}) {
      const expression = `${prelude ? `(${prelude.toString()})();` : ''}(${fn.toString()})(${JSON.stringify(arg)})`;
      for (let attempt = 0; ; attempt++) {
        if (contextId === null) await withTimeout(create(), timeoutMs, 'PROBE_TIMEOUT');
        try {
          const result = await withTimeout(cdp.send('Runtime.evaluate', {contextId, expression, awaitPromise: true, returnByValue: true}), timeoutMs, 'PROBE_TIMEOUT');
          if (result.exceptionDetails) throw Object.assign(Error(`PROBE_FAILED: ${short(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text, 300)}`), {code: 'PROBE_FAILED'});
          return result.result.value;
        } catch (error) {
          if (attempt === 0 && /Cannot find context|context with specified id|Execution context was destroyed|Inspected target navigated/i.test(error.message)) { contextId = null; continue; }
          throw error;
        }
      }
    },
    reset() { contextId = null; },
  };
}
