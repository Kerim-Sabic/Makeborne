/* eslint-disable @typescript-eslint/no-require-imports */
const {canonicalRuntimeJson} = require("./identity.mjs");
const legacy = require("./legacy-toolchain.json");
/** Both files must match one complete trusted pair, never a mixture. */
function toolchainCompatibility(files, approvedPackage, approvedLock) {
  if (files.some(file => /(?:^|\/)(?:vite|postcss|tailwind)\.config\./i.test(file.path))) throw new Error("Custom build configuration needs a supported toolchain.");
  const read = path => {
    const file = files.find(file => file.path === path);
    if (!file) throw new Error("The project is missing its approved dependency lock.");
    return canonicalRuntimeJson(JSON.parse(file.content));
  };
  const actualPackage = read("package.json"), actualLock = read("package-lock.json");
  for (const [id, pair] of [["current", {package: approvedPackage, lock: approvedLock}], ["react-vite-v1-pre-fonts", legacy]]) {
    if (actualPackage === canonicalRuntimeJson(pair.package) && actualLock === canonicalRuntimeJson(pair.lock)) return id;
  }
  throw new Error("This project needs the approved React/Vite dependency lock. Package changes need a reviewed toolchain update.");
}
function portableToolchainFiles(files, approvedPackage, approvedLock) {
  const compatibility = toolchainCompatibility(files, approvedPackage, approvedLock);
  return {compatibility, files: files.map(file => compatibility === "current" ? {...file}
    : file.path === "package.json" ? {...file, content: JSON.stringify(approvedPackage, null, 2)}
    : file.path === "package-lock.json" ? {...file, content: JSON.stringify(approvedLock)} : {...file})};
}
module.exports = {toolchainCompatibility, portableToolchainFiles};
