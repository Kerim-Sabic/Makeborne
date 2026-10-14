/* eslint-disable @typescript-eslint/no-require-imports -- Offline contract check: connection status renews instead of expiring at eight hours. */
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const route = fs.readFileSync(path.join(__dirname, "..", "..", "app", "api", "github", "connection", "route.ts"), "utf8");
assert.doesNotMatch(route, /expires_at/, "status must not treat an expired eight-hour token as disconnected; githubConnection renews it");
assert.match(route, /githubConnection\(user\.id\)/);
assert.match(route, /error\.code==="GITHUB_RECONNECT"\)return cloudJson\(\{configured:true,connected:false,installUrl\}\)/, "only a rejected connection reads as disconnected");
const ui = fs.readFileSync(path.join(__dirname, "..", "..", "components", "website-github.tsx"), "utf8");
assert.doesNotMatch(ui, /eight hours/, "UI copy no longer promises an eight-hour expiry");
console.log("PASS GitHub connection status renews instead of expiring at eight hours");
