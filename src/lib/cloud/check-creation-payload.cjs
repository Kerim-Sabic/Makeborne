/* eslint-disable @typescript-eslint/no-require-imports -- Offline payload regression checks. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { buildCreationPayload } = require("./creation-payload.ts");
const values = { title: "Account draft", kind: "website", effort: "ultra", brief: "Approved brief", audience: "Clients", purpose: "Explain", styleId: "custom-mint", clientId: "", wording: "preserve", content: "Heading\n\nSupplied paragraph" };
const style = { id: "custom-mint", name: "Mint", color: "#90EDAA", background: "#122822", textColor: "#FFFFFF", font: "sans", description: "Custom palette" };
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
const body = buildCreationPayload(values, style, randomUUID);
check("preserves supplied text", () => assert.deepEqual(body.content.sections[0].blocks.map(block => block.text), ["Heading", "Supplied paragraph"]));
check("preserves effort", () => assert.equal(body.project.effort, "ultra"));
check("keeps custom dark palette", () => assert.equal(body.style.colors.canvas, "#122822"));
check("empty client is null", () => assert.equal(body.project.clientId, null));
check("selected client remains attached", () => { const clientId = randomUUID(); assert.equal(buildCreationPayload({ ...values, clientId }, style, randomUUID).project.clientId, clientId); });
check("JSON retry retains stable IDs", () => assert.deepEqual(JSON.parse(JSON.stringify(body)), body));
check("empty material starts with supplied title", () => assert.equal(buildCreationPayload({ ...values, content: "" }, style, randomUUID).content.sections[0].blocks[0].text, values.title));
check("mismatched style rejected", () => assert.throws(() => buildCreationPayload(values, { ...style, id: "other" }, randomUUID)));
check("overlong title rejected", () => assert.throws(() => buildCreationPayload({ ...values, title: "a".repeat(161) }, style, randomUUID)));
for (const wording of ["preserve", "improve", "summarise"]) check(`retains ${wording} preference`, () => assert.equal(buildCreationPayload({ ...values, wording }, style, randomUUID).project.wording, wording));
check("source-only creation supported", () => assert.equal(buildCreationPayload({ ...values, brief: "" }, style, randomUUID).content.sections[0].blocks[1].text, "Supplied paragraph"));
console.log(`${checks} creation payload checks passed.`);
