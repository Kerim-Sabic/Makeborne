// Trusted build-time generator. Commit the catalogue after an intentional upgrade.
// Normal prebuild verifies exact installed bytes without rewriting trust data.
import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const {catalog, fontPackage} = require("../infra/project-runtime/font-portability.cjs");
const pkg = require("../infra/project-runtime/toolchain/package.json");
const lock = require("../infra/project-runtime/toolchain/package-lock.json");
const root = fileURLToPath(new URL("../", import.meta.url));
const target = resolve(root, "infra/project-runtime/font-licenses.json");

export async function prepareFontLicenses({write = false} = {}) {
  const licenses = {};
  for (const font of catalog) {
    const name = fontPackage(font);
    const folder = resolve(root, "node_modules", name);
    const installed = JSON.parse(await readFile(resolve(folder, "package.json"), "utf8"));
    const version = pkg.dependencies[name];
    if (!/^\d+\.\d+\.\d+$/.test(version) || installed.version !== version || lock.packages[`node_modules/${name}`]?.version !== version) {
      throw new Error(`Font license package does not match the approved lock: ${name}`);
    }
    const content = await readFile(resolve(folder, "LICENSE"), "utf8");
    if (!/SIL OPEN FONT LICENSE/i.test(content)) throw new Error(`Unexpected font license: ${name}`);
    licenses[font.id] = {package: name, version, sha256: createHash("sha256").update(content).digest("hex"), content};
  }
  const expected = `${JSON.stringify({schemaVersion: 1, licenses}, null, 2)}\n`;
  if (write) await writeFile(target, expected);
  else if (await readFile(target, "utf8") !== expected) {
    throw new Error("Trusted font licenses differ from installed approved packages. Review the change and run node scripts/prepare-font-licenses.mjs --write.");
  }
  return expected;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareFontLicenses({write: process.argv.includes("--write")});
  console.log("Trusted font license catalogue verified.");
}
