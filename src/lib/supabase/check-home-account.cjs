/* eslint-disable @typescript-eslint/no-require-imports -- Offline navigation and rendering checks. */
const fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript"), assert = require("node:assert/strict");
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
function load(filename, modules) {
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const context = { exports: {}, URL, URLSearchParams, require: name => name in modules ? modules[name] : require(name) };
  vm.runInNewContext(source, context);
  return context.exports;
}
const { authDestination } = load("src/lib/supabase/auth-flow.ts", {});
const StudioAccount = load("src/components/studio-account.tsx", {
  "next/link": ({ children, ...props }) => React.createElement("a", props, children),
  "next/navigation": { useRouter: () => ({ refresh() {} }) },
  "@/lib/supabase/client": { createClient: () => { throw new Error("No live auth calls allowed"); } },
}).default;
for (const variant of ["home", "home-mobile"]) {
  const html = renderToStaticMarkup(React.createElement(StudioAccount, { initialEmail: "fixture@example.invalid", enabled: true, variant }));
  assert.match(html, /fixture@example.invalid/);
  assert.match(html, /Account/); assert.match(html, /Sign out/); assert.match(html, /href="\/billing"/);
  assert.doesNotMatch(html, /href="\/login"/);
  assert.doesNotMatch(html, /Checking account/);
  const guest = renderToStaticMarkup(React.createElement(StudioAccount, { initialEmail: null, enabled: true, variant }));
  assert.match(guest, /href="\/login"/); assert.doesNotMatch(guest, /Sign out/);
}
let currentUser = { id: "fixture", email: "fixture@example.invalid" };
const Login = load("src/app/login/page.tsx", {
  "@/components/account-form": () => React.createElement("form", null, "Sign in"),
  "@/lib/billing/access": { billingUser: async () => currentUser },
  "@/lib/supabase/auth-flow": { authDestination },
  "next/navigation": { redirect: destination => { throw { destination }; } },
}).default;
async function run() {
  for (const [params, expected] of [[{}, "/studio"], [{ next: "/admin" }, "/admin"], [{ next: "/chat" }, "/chat"], [{ next: "https://evil.example" }, "/studio"], [{ next: ["/admin", "https://evil.example"] }, "/studio"], [{ mode: "signup", next: "/billing#credits" }, "/billing#credits"]]) {
    await assert.rejects(Login({ searchParams: Promise.resolve(params) }), error => error.destination === expected);
  }
  currentUser = null;
  const guestForm = await Login({ searchParams: Promise.resolve({ next: "/admin" }) });
  assert.match(renderToStaticMarkup(guestForm), /Sign in/);
  const proxy = fs.readFileSync("src/proxy.ts", "utf8");
  assert.match(proxy, /matcher: \["\/", "\/admin"/);
  console.log("PASS: signed-in desktop/mobile account menus, guest navigation, login redirect, safe return paths, and homepage/admin session refresh coverage. No live services called.");
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
