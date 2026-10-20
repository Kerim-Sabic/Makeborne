// Local-only `next dev` on 127.0.0.1:3231 against the DISPOSABLE stack makeborne-rc-20261019
// (API 127.0.0.1:55481), for checking the refund and auto top-up screens. Same blanking rule as
// docs/release-review/rc-20261019/rc-server.mjs: every provider, billing, cloud and mail key is
// removed, then only the keys below are set. No payment provider, AI or mail key is present.
// MAKEBORNE_AUTOTOPUP_SETUP_ENABLED=true shows the authorization screen (never set in production).
// Usage (worktree root): node docs/release-review/launch-20261020/local-server.mjs
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { envFileKeys } from "../../../scripts/eval/e2e/server.mjs";

const HOST = "127.0.0.1", PORT = 3231;
const status = JSON.parse(readFileSync("../rc-20261019/work/rc-stack/status.json", "utf8"));
assert.equal(status.API_URL, "http://127.0.0.1:55481", "Refusing: not the disposable rc stack API");
assert.equal(new URL(status.DB_URL).port, "55482", "Refusing: not the disposable rc stack database");
const BLANKED = /^(ANTHROPIC_|OPENAI_|WHOP_|SUPABASE_|NEXT_PUBLIC_SUPABASE_|MAKEBORNE_|NEXT_PUBLIC_MAKEBORNE_|VERCEL|CRON_SECRET|AWS_|RESEND_|GOOGLE_|GITHUB_|CLOUDFLARE_)/;
const env = { ...process.env };
const blank = key => { for (const name of Object.keys(env)) if (name.toUpperCase() === key.toUpperCase()) delete env[name]; env[key] = ""; };
for (const key of Object.keys(env)) if (BLANKED.test(key)) blank(key);
for (const key of envFileKeys(process.cwd())) blank(key);
Object.assign(env, {
  NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
  MAKEBORNE_CLOUD_ENABLED: "true", MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED: "true", MAKEBORNE_RELEASE_MAINTENANCE: "off",
  NEXT_PUBLIC_SITE_URL: `http://${HOST}:${PORT}`, NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY, SUPABASE_SECRET_KEY: status.SECRET_KEY,
  MAKEBORNE_LIVE_BUILDER_ENABLED: "false", MAKEBORNE_AUTOTOPUP_SETUP_ENABLED: "true",
});
console.log(`[launch server] next dev on http://${HOST}:${PORT} -> ${status.API_URL} (provider, billing and mail keys blank)`);
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", HOST, "--port", String(PORT)], { env, stdio: "inherit" });
child.on("exit", code => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
