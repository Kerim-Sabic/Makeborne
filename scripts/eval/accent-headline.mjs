// Counts the "one coloured or highlighted phrase in the headline" device across
// measured sets: in the h1 of each published page at 1440×900, any descendant
// whose text colour differs clearly from the h1's own colour, or that paints its
// own background (a highlighter), or that is set in italic. Reports per site and
// per set. Read-only over outputs/eval/measure/<set>/<item>/ (published + build).
// This is the device W15 only catches in its serif-italic-on-cream form.
//
//   node scripts/eval/accent-headline.mjs outputs/eval/measure/<setA> [<setB> ...]
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { readJson, rel } from './lib/paths.mjs';
import { serveWebsite } from './lib/website.mjs';

/** In-page: describe the h1's accent phrases. */
function inspectHeadline() {
  const h1 = document.querySelector('h1');
  if (!h1) return { h1: false };
  const parse = value => (value.match(/[\d.]+/g) ?? []).map(Number);
  const own = getComputedStyle(h1);
  const [r, g, b] = parse(own.color);
  const distance = colour => { const [r2, g2, b2] = parse(colour); return Math.hypot(r - r2, g - g2, b - b2); };
  const accents = [];
  for (const element of h1.querySelectorAll('*')) {
    const text = (element.textContent ?? '').trim();
    if (!text || element.closest('[aria-hidden="true"]')) continue;
    const style = getComputedStyle(element);
    const colour = distance(style.color) > 60;
    const background = !/rgba\(0, 0, 0, 0\)|transparent/.test(style.backgroundColor) || /gradient/.test(style.backgroundImage);
    const italic = style.fontStyle === 'italic' && own.fontStyle !== 'italic';
    if (colour || background || italic) accents.push({ text: text.slice(0, 40), colour, background, italic, fontFamily: style.fontFamily.split(',')[0].replace(/["']/g, '') });
  }
  const family = own.fontFamily.split(',')[0].replace(/["']/g, '');
  return { h1: true, text: h1.textContent.trim().slice(0, 80), family, accents, accented: accents.length > 0 };
}

export async function measureAccents(setDirs) {
  const browser = await chromium.launch({ headless: true });
  const report = [];
  try {
    for (const setDir of setDirs) {
      const sites = [];
      for (const name of readdirSync(setDir).sort()) {
        const itemDir = path.join(setDir, name);
        const metricsFile = path.join(itemDir, 'metrics.json');
        if (!existsSync(metricsFile) || readJson(metricsFile).kind !== 'website' || !existsSync(path.join(itemDir, 'published', 'index.html'))) continue;
        const server = await serveWebsite(itemDir, { variant: 'published', hostHeaders: false });
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
        try {
          await page.goto(server.url + '/', { waitUntil: 'load' });
          await page.evaluate(() => document.fonts.ready);
          sites.push({ item: name, ...(await page.evaluate(inspectHeadline)) });
        } catch (error) {
          sites.push({ item: name, error: error.message.split('\n')[0] });
        } finally { await page.close(); await server.close(); }
      }
      const measured = sites.filter(site => site.h1);
      report.push({ set: rel(setDir), sites: measured.length, accented: measured.filter(site => site.accented).length,
        byKind: { colour: measured.filter(site => site.accents.some(a => a.colour)).length, highlight: measured.filter(site => site.accents.some(a => a.background)).length, italic: measured.filter(site => site.accents.some(a => a.italic)).length },
        detail: sites });
    }
  } finally { await browser.close(); }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) { console.error('usage: node scripts/eval/accent-headline.mjs <measureDir> [...]'); process.exit(2); }
  measureAccents(dirs.map(dir => path.resolve(dir))).then(report => {
    for (const set of report) {
      console.log(`\n${set.set}: ${set.accented} of ${set.sites} headlines carry an accent phrase (colour ${set.byKind.colour}, highlight ${set.byKind.highlight}, italic ${set.byKind.italic})`);
      for (const site of set.detail) console.log(`  ${site.item.padEnd(38)} ${site.error ? `error: ${site.error}` : `${site.accented ? 'ACCENT' : '      '} ${site.family.padEnd(20)} ${site.accents?.map(a => `"${a.text}"${a.colour ? ' colour' : ''}${a.background ? ' highlight' : ''}${a.italic ? ' italic' : ''}`).join('; ') ?? ''}`}`);
    }
  }, error => { console.error(error); process.exitCode = 1; });
}
