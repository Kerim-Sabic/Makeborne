// Read-only readiness check for Claude/Codex local tests. Never resets a stack.
import { spawnSync } from 'node:child_process';
function run(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Docker check failed: ${args.slice(0, 3).join(' ')}. Open Docker Desktop and inspect its status; do not reset or prune data.`);
  return result.stdout.trim();
}
const report = { engine: JSON.parse(run(['version', '--format', '{{json .Server}}'])).Version, databases: [] };
for (const name of ['supabase_db_makeborne-journey-audit', 'makeborne-apps-pg']) {
  const state = JSON.parse(run(['inspect', '--format', '{{json .State}}', name]));
  if (!state.Running) throw new Error(`${name} is stopped. Coordinate before starting the shared test stack.`);
  run(['exec', name, 'pg_isready', '-U', 'postgres']);
  const result = run(['exec', name, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', 'select 1']);
  if (result !== '1') throw new Error(`${name} did not answer its read-only query`);
  report.databases.push({ name, running: true, readiness: 'passed', query: 'passed' });
}
console.log(JSON.stringify(report, null, 2));
