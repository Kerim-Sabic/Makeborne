// Cross-platform wrapper for `npm run e2e:launch-gate`: runs the studio suite
// with E2E_GATE set (npm scripts cannot set env vars portably on Windows).
// Usage: node scripts/eval/e2e/run-gate.mjs <baseline|launch> [extra Playwright args]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [gate = 'launch', ...rest] = process.argv.slice(2);
if (!['baseline', 'launch'].includes(gate)) {
  console.error(`Unknown gate "${gate}": use baseline or launch`);
  process.exit(2);
}
const cli = path.join(here, '..', 'node_modules', '@playwright', 'test', 'cli.js');
const child = spawn(process.execPath, [cli, 'test', '-c', path.join(here, 'playwright.config.mjs'), ...rest], {
  stdio: 'inherit',
  env: { ...process.env, E2E_GATE: gate },
});
child.on('exit', code => process.exit(code ?? 1));
