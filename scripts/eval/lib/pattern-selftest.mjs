// Browser self-test of the builder prompt's motion, form and route patterns
// (src/lib/builder/prompt.ts MOTION_PATTERN / FORM_PATTERN / ROUTE_PATTERN),
// assembled into a small project and run through the eval's real website
// pipeline: compile -> captured static snapshot -> published page. Free: no
// provider, database or network calls.
//
//   node scripts/eval/lib/pattern-selftest.mjs
//
// Checks: nothing is hidden in the static snapshot or under reduced motion;
// on-screen blocks are visible at load on the published page; below-fold
// blocks wait and are revealed on scroll (including clip-path wipes); a failed
// form submit focuses the error summary and links the field error; a summary
// link focuses its field; a client-side page change sets the page title,
// focuses the new h1 and announces it; an unknown page is "Page not found".
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { materializeWebsite, serveWebsite } from './website.mjs';

const require = createRequire(import.meta.url);
const { loadApp } = require('./app-modules.cjs');

const between = (text, start, end) => { const from = text.indexOf(start) + start.length; return text.slice(from, end ? text.indexOf(end, from) : undefined).trim(); };

/** The patterns as a two-section, one-form, hash-routed project. */
export function patternProject() {
  const { MOTION_PATTERN, FORM_PATTERN, ROUTE_PATTERN } = loadApp('src/lib/builder/prompt.ts');
  const { ProjectFiles } = loadApp('src/lib/builder/files.ts');
  const formLines = FORM_PATTERN.split('\n');
  const jsxStart = formLines.findIndex(line => line.startsWith('{Object.keys(errors)'));
  const files = new ProjectFiles();
  files.write('index.html', '<!doctype html><html lang="en"><head><title>T</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
  files.write('src/main.tsx', 'import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles/motion.css";\nimport "./styles/site.css";\ncreateRoot(document.getElementById("root")!).render(<App />);\n');
  files.write('src/useReveal.ts', between(MOTION_PATTERN, 'src/useReveal.ts:\n', '\nCall useReveal'));
  files.write('src/styles/motion.css', between(MOTION_PATTERN, 'src/styles/motion.css:\n'));
  files.write('src/styles/site.css', 'body{margin:0;font:18px/1.6 system-ui;color:#111;background:#f4f1ea} section{min-height:70vh;padding:40px} .block{height:160px;margin:12px 0;background:#cbb} .fill{height:100%;background:#544} .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap} .error-summary{border:3px solid #a00;padding:12px} input,button{min-height:48px;font-size:1rem}');
  files.write('src/components/Enquiry.tsx', `import { useRef, useState, type FormEvent } from "react";
function validate(data: FormData): Record<string, string> {
  const found: Record<string, string> = {};
  if (!String(data.get("email") ?? "").includes("@")) found.email = "Enter an email address like name@example.com";
  return found;
}
export default function Enquiry() {
  const [sent, setSent] = useState(false);
${formLines.slice(0, jsxStart).join('\n').replace('// ...send; on accepted === true:', 'if (!sent) {')}
}
  return (
    <form onSubmit={onSubmit} noValidate>
${formLines.slice(jsxStart).join('\n').replace('…', 'Thanks, your enquiry was sent.')}
      <button type="submit">Send the enquiry</button>
    </form>
  );
}
`);
  files.write('src/App.tsx', `import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useReveal } from "./useReveal";
import Enquiry from "./components/Enquiry";
const SITE_NAME = "Saffron Table";
export default function App() {
${ROUTE_PATTERN.split('\n').filter(line => !line.startsWith('// In App:')).join('\n')}
  useReveal(path);
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <main id="main">
        <section>{PAGES[path] ? <h1>{title}</h1> : <NotFound />}{[0, 1].map(index => <div key={index} className="block top" data-reveal="" style={{ "--i": index } as CSSProperties} />)}</section>
        <section>{[0, 1, 2].map(index => <div key={index} className="block low" data-reveal={index === 1 ? "wipe" : ""} style={{ "--i": index } as CSSProperties}><div className="fill" /></div>)}</section>
        <section><Enquiry /></section>
      </main>
      <p id="route-status" className="sr-only" aria-live="polite"></p>
    </>
  );
}
function NotFound() { return <><h1>Page not found</h1><p>That page does not exist.</p><a href="#/">Back to the home page</a></>; }
`);
  return files.toSource();
}

export async function selfTest({ log = console.log } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'makeborne-pattern-selftest-'));
  const results = [];
  const ok = (name, pass, detail) => { results.push({ name, pass: Boolean(pass) }); log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${pass || detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 300)}`}`); };
  const browser = await chromium.launch();
  const blocks = page => page.$$eval('.block', els => els.map(el => ({ low: el.classList.contains('low'), opacity: +getComputedStyle(el).opacity, clip: getComputedStyle(el.firstElementChild ?? el).clipPath })));
  const shown = item => item.opacity === 1 && !item.clip.includes('100%');
  try {
    const source = patternProject();
    await materializeWebsite({ itemDir: dir, outDir: dir, browser, source, item: { id: 'pattern-selftest', title: 'Saffron Table' } });
    for (const variant of ['snapshot', 'published']) {
      const server = await serveWebsite(dir, { variant });
      for (const motion of ['no-preference', 'reduce']) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: motion });
        const page = await context.newPage();
        await page.goto(server.url, { waitUntil: 'load' });
        await page.waitForTimeout(150);
        const first = await blocks(page);
        ok(`${variant}/${motion}: on-screen blocks visible at load`, first.filter(item => !item.low).every(shown), first);
        if (variant === 'published' && motion === 'no-preference') {
          ok(`${variant}/${motion}: a below-fold block waits`, first.some(item => item.low && !shown(item)), first);
          for (let y = 300; y <= 2400; y += 300) { await page.evaluate(top => scrollTo(0, top), y); await page.waitForTimeout(120); }
          await page.waitForTimeout(1300);
          const after = await blocks(page);
          ok(`${variant}/${motion}: below-fold blocks (rise and wipe) revealed on scroll`, after.every(shown), after);
          await page.evaluate(() => scrollTo(0, 0));
          await page.click('button[type=submit]');
          await page.waitForTimeout(200);
          const focus = await page.evaluate(() => ({ className: document.activeElement?.className, role: document.activeElement?.getAttribute('role'), invalid: document.getElementById('email')?.getAttribute('aria-invalid'), describedBy: document.getElementById('email')?.getAttribute('aria-describedby') }));
          ok('form: a failed submit focuses the error summary and links the field error', focus.className === 'error-summary' && focus.role === 'alert' && focus.invalid === 'true' && focus.describedBy === 'email-error', focus);
          await page.click('.error-summary a');
          ok('form: a summary link focuses its field', await page.evaluate(() => document.activeElement?.id === 'email'));
          await page.evaluate(() => { location.hash = '#/missing'; });
          await page.waitForTimeout(300);
          const route = await page.evaluate(() => ({ title: document.title, focus: document.activeElement?.tagName, text: document.activeElement?.textContent, status: document.getElementById('route-status')?.textContent }));
          ok('route: an unknown page is titled, focused and announced as "Page not found"', route.title === 'Page not found — Saffron Table' && route.focus === 'H1' && route.text === 'Page not found' && route.status === 'Page not found page', route);
          await page.evaluate(() => { location.hash = '#/menu'; });
          await page.waitForTimeout(300);
          ok('route: a known page sets its own title', (await page.title()) === 'Menu — Saffron Table');
        } else {
          ok(`${variant}/${motion}: nothing below the fold is hidden`, first.every(shown), first);
        }
        await context.close();
      }
      await server.close();
    }
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
  const failed = results.filter(item => !item.pass);
  return { ok: failed.length === 0, checks: results.length, failed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('pattern-selftest.mjs (motion, form and route patterns in a real browser; no provider calls)');
  selfTest().then(result => { console.log(`\n${result.ok ? 'PASS' : 'FAIL'}: ${result.checks - result.failed.length}/${result.checks} checks`); process.exitCode = result.ok ? 0 : 1; },
    error => { console.error(error); process.exitCode = 1; });
}
