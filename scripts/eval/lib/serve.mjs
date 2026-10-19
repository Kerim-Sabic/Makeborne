// Minimal static file server for built sites and snapshots (127.0.0.1 only).
import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serve `root`. Unknown extension-less paths fall back to index.html (state- or
 * hash-routed sites), so a route listed by finish.routes still renders.
 * Records every response so callers can count bytes and 404s.
 *
 * Options (all optional, backwards compatible):
 * - `aliases`: { '/site.js': { file, type? } } serves a URL path from any file,
 *   e.g. the lint-safe `site.js.bundle` at `/site.js` with a JavaScript type.
 *   Aliases win over files under `root`.
 * - `headers`: extra response headers, either an object or a function
 *   ({ pathname, type, document }) => object, e.g. the site host's CSP.
 */
export async function serve(root, { port = 0, log, aliases = {}, headers } = {}) {
  const base = path.resolve(root);
  const requests = [];
  const extra = context => (typeof headers === 'function' ? headers(context) : headers) ?? {};
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    let file, type;
    try {
      const pathname = decodeURIComponent(url.pathname);
      const alias = Object.hasOwn(aliases, pathname) ? aliases[pathname] : null;
      if (alias) {
        file = path.resolve(alias.file);
        type = alias.type;
      } else {
        file = path.resolve(base, '.' + pathname);
        if (file !== base && !file.startsWith(base + path.sep)) { response.writeHead(403).end(); return; }
      }
      let info = await stat(file).catch(() => null);
      if (!alias && info?.isDirectory()) { file = path.join(file, 'index.html'); info = await stat(file).catch(() => null); }
      if (!alias && !info && !path.extname(file)) { file = path.join(base, 'index.html'); info = await stat(file).catch(() => null); }
      if (!info?.isFile()) { requests.push({ path: url.pathname, status: 404, bytes: 0 }); response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
      const body = await readFile(file);
      type ??= TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      requests.push({ path: url.pathname, status: 200, bytes: body.length, type });
      response.writeHead(200, {
        'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store',
        ...extra({ pathname: url.pathname, type, document: type.startsWith('text/html') }),
      });
      response.end(body);
    } catch (error) {
      log?.(`serve error ${url.pathname}: ${error.message}`);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const { port: bound } = server.address();
  return {
    url: `http://127.0.0.1:${bound}`,
    requests,
    reset() { requests.length = 0; },
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
