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

/** Collects the page's errors into `errors`. WebKit's driver reports a fetch that the page starts and catches while it
 * unloads as a page error "<url> due to access control checks."; exactly that message, in WebKit only and only while
 * the check itself reloads or navigates the page, is printed as a NOTE instead. Every other page error is collected. */
function collectPageErrors(page, errors) {
  let unloading = 0;
  for (const method of ["reload", "goto"]) {
    const original = page[method].bind(page);
    page[method] = async (...parameters) => { unloading++; try { return await original(...parameters); } finally { unloading--; } };
  }
  page.on("pageerror", error => {
    if (engine === "webkit" && unloading && /^\S+ due to access control checks\.$/.test(error.message)) {
      console.log(`NOTE WebKit reported a fetch cancelled by the check's own reload: ${error.message}`);
      return;
    }
    errors.push(error.message);
  });
  return errors;
}

module.exports = { ENGINES, engine, engineLabel, args, browserType: playwright[engine], collectPageErrors, engineOnly, selectedEngine };
