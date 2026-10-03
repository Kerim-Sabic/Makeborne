/* eslint-disable @typescript-eslint/no-require-imports -- Offline request concurrency regression checks. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..").replaceAll("\\", "/");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8").replaceAll('"@/', `"${root}/`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { api } = require("./cloud-api.ts");
(async () => {
  const waiting = [];
  global.fetch = () => new Promise(resolve => waiting.push(resolve));
  const first = api("/api/workspaces"), second = api("/api/workspaces");
  assert.equal(waiting.length, 2, "concurrent reads reach the server");
  waiting.splice(0).forEach(resolve => resolve(new Response(JSON.stringify({ workspaces: [] }))));
  assert.deepEqual(await Promise.all([first, second]), [{ workspaces: [] }, { workspaces: [] }]);
  console.log("PASS overlapping reads both complete");
  const clientPath = "/api/cloud/workspaces/00000000-0000-4000-8000-000000000001/clients/00000000-0000-4000-8000-000000000002";
  const body = { name: "Fixture", expectedUpdatedAt: "2026-10-04T00:00:00.000Z" };
  const write = api(clientPath, body, "PATCH");
  await assert.rejects(api(clientPath, body, "PATCH"), error => error.code === "REQUEST_PENDING");
  assert.equal(waiting.length, 1, "duplicate writes do not reach the server");
  waiting.shift()(new Response(JSON.stringify({ error: { message: "Fixture rejection" } }), { status: 409 }));
  await assert.rejects(write, /Fixture rejection/);
  console.log("PASS duplicate writes remain blocked");
  const retry = api(clientPath, body, "PATCH");
  assert.equal(waiting.length, 1);
  waiting.shift()(new Response(JSON.stringify({ error: { message: "Fixture rejection" } }), { status: 409 }));
  await assert.rejects(retry, /Fixture rejection/);
  console.log("PASS completed requests release the write lock");
})().catch(error => { console.error(error); process.exitCode = 1; });
