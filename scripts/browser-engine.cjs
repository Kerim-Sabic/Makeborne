/* eslint-disable @typescript-eslint/no-require-imports -- Shared engine selection for the mounted browser checks. */
// Every scripts/check-*-browser.cjs check runs in Chromium by default. Pass `--engine firefox|webkit`
// (or `--engine=webkit`), or set PW_ENGINE, to run the same scenarios in another Playwright engine.
// A measurement that only exists in one engine (for example PDF printing, which Playwright offers only in
// headless Chromium) stays in that engine and is reported with `engineOnly(...)`, never silently passed.
const playwright = require("playwright");

const ENGINES = ["chromium", "firefox", "webkit"];
function selectedEngine(argv = process.argv, env = process.env) {
  const inline = argv.find(arg => arg.startsWith("--engine="));
  const index = argv.indexOf("--engine");
  const value = (inline ? inline.slice("--engine=".length) : index >= 0 ? argv[index + 1] : env.PW_ENGINE || "chromium").toLowerCase();
  if (!ENGINES.includes(value)) throw new Error(`Unknown browser engine "${value}". Use one of: ${ENGINES.join(", ")}.`);
  return value;
}

const engine = selectedEngine();
const engineLabel = { chromium: "Chromium", firefox: "Firefox", webkit: "WebKit" }[engine];
/** The check's own command-line arguments, without the engine flag (so `args[0]` stays e.g. a screenshot folder). */
const args = process.argv.slice(2).filter((arg, index, all) => !arg.startsWith("--engine=") && arg !== "--engine" && all[index - 1] !== "--engine");

/** Logs, in the check's own output, that a measurement is limited to some engines and was not made here. */
function engineOnly(engines, what) {
  const list = [].concat(engines);
  if (list.includes(engine)) return true;
  console.log(`SKIP ${what} — ${list.map(name => name[0].toUpperCase() + name.slice(1)).join("/")}-only measurement, not available in ${engineLabel}.`);
  return false;
}

module.exports = { ENGINES, engine, engineLabel, args, browserType: playwright[engine], engineOnly, selectedEngine };
