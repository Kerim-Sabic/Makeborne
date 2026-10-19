// Local-only `next dev` for the release-candidate journeys: 127.0.0.1:3230 against the
// DISPOSABLE stack makeborne-rc-20261019 (API 127.0.0.1:55481). Every provider, billing,
// cloud and mail key inherited from the shell or named in an env file is blanked first
// (same rule as scripts/eval/e2e/server.mjs), then only the keys below are set.
//
// RC_BUILDER=paused (default) mirrors production: a builder key is configured but every
// provider spending scope is disabled in the database, so GET /api/build answers
// "paused" and POST /api/build is refused by the capacity gate before any provider
// contact. The key is a non-secret placeholder, so even a bug could not reach a paid API.
// RC_BUILDER=off blanks the key (builder not configured).
// Usage (worktree root): node docs/release-review/rc-20261019/rc-server.mjs
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { envFileKeys } from "../../../scripts/eval/e2e/server.mjs";

const HOST = "127.0.0.1", PORT = Number(process.env.RC_PORT ?? 3230);
assert(PORT >= 3230 && PORT <= 3239, "RC ports are 3230-3239");
const status = JSON.parse(readFileSync("work/rc-stack/status.json", "utf8"));
assert.equal(status.API_URL, "http://127.0.0.1:55481", "Refusing: not the disposable rc stack API");
assert.equal(new URL(status.DB_URL).port, "55482", "Refusing: not the disposable rc stack database");
assert(status.PUBLISHABLE_KEY?.startsWith("sb_publishable_") && status.SECRET_KEY?.startsWith("sb_secret_"));

const BLANKED = /^(ANTHROPIC_|OPENAI_|WHOP_|SUPABASE_|NEXT_PUBLIC_SUPABASE_|MAKEBORNE_|NEXT_PUBLIC_MAKEBORNE_|VERCEL|CRON_SECRET|AWS_|RESEND_|GOOGLE_|GITHUB_|CLOUDFLARE_)/;
const env = { ...process.env };
const blank = key => { for (const name of Object.keys(env)) if (name.toUpperCase() === key.toUpperCase()) delete env[name]; env[key] = ""; };
for (const key of Object.keys(env)) if (BLANKED.test(key)) blank(key);
for (const key of envFileKeys(process.cwd())) blank(key);
const builder = process.env.RC_BUILDER ?? "paused";
Object.assign(env, {
  NODE_ENV: "development",
  NEXT_TELEMETRY_DISABLED: "1",
  MAKEBORNE_CLOUD_ENABLED: "true",
  MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED: "true",
  MAKEBORNE_RELEASE_MAINTENANCE: "off",
  NEXT_PUBLIC_SITE_URL: `http://${HOST}:${PORT}`,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: status.SECRET_KEY,
  MAKEBORNE_LIVE_BUILDER_ENABLED: builder === "off" ? "false" : "true",
  ANTHROPIC_API_KEY: builder === "off" ? "" : "offline-placeholder-not-a-key",
  MAKEBORNE_TRUSTED_PUBLICATION_ENABLED: "",
});
console.log(`[rc server] next dev on http://${HOST}:${PORT} -> ${status.API_URL} (builder ${builder}; provider, billing and mail keys blank)`);
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", HOST, "--port", String(PORT)], { env, stdio: "inherit" });
child.on("exit", code => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
