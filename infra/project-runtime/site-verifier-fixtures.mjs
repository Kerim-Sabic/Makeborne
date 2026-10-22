/** Small fictional hash-routed websites for the site-verifier checks: one good site and one defect per option.
 * Written like generated sites (hash routes "#/page", section anchors, a toggle menu, an enquiry form posting JSON
 * to /_mb/enquiries) but in plain browser JavaScript, so the checks need no bundler. CSP-safe: one same-origin
 * module, no inline scripts or handlers. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

export const FIXTURE_ROUTES = Object.freeze([{path: '/', title: 'Home'}, {path: '/menu', title: 'Menu'}]);

/** Options (all false by default): deadLink, menuNeverOpens, menuNoEscape, overflow360, fixedBar, brokenImage,
 * runtimeError, formNoStatus, formTwice, formOffOrigin, reducedHidden, unknownBlank, primaryNoop, focusInvisible,
 * keyboardTrap, canaryPort (a localhost port the page tries to reach in every way it can). */
export function fixtureSite(options = {}) {
  const o = options;
  const css = `*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#1b1b1b;background:#fff}
header{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;background:#fff;border-bottom:1px solid #ddd}
.mark{font-weight:800;color:#1b1b1b;text-decoration:none}.nav{display:flex;gap:14px}.toggle{display:none;font:inherit;padding:6px 12px}
@media (max-width:767px){.toggle{display:inline-block}.nav{display:none;position:absolute;top:100%;left:0;right:0;flex-direction:column;background:#fff;padding:12px 16px;border-bottom:1px solid #ddd}.nav.open{display:flex}}
main{padding:24px 16px}.hero{min-height:55vh}.cta{display:inline-block;background:#8a2d1c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700;border:0;font-size:16px}
section{padding:32px 0}section[id]{scroll-margin-top:80px}.filler{height:900px;background:#f3eee8}
label{display:block;margin:8px 0}input,textarea{display:block;width:100%;max-width:420px;padding:8px;font:inherit}img{display:block;max-width:100%;height:auto}
@media (prefers-reduced-motion:no-preference){html.js [data-reveal]{opacity:0;transform:translateY(24px);transition:opacity .3s,transform .3s}html.js [data-reveal][data-in]{opacity:1;transform:none}}
${o.reducedHidden ? '[data-reveal]{opacity:0}[data-reveal][data-in]{opacity:1}.spinner{display:inline-block;width:20px;height:20px;border:3px solid #8a2d1c;border-right-color:transparent;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}' : ''}
${o.fixedBar ? '.promo{position:fixed;left:0;right:0;bottom:0;height:75vh;background:#222;color:#fff;padding:16px;z-index:9}' : ''}
${o.focusInvisible ? 'a:focus,button:focus,input:focus,textarea:focus{outline:none}' : ''}`;
  const extraNav = o.deadLink ? '<a href="#/journal">Journal</a><a href="#opening-hours">Hours</a>' : '';
  const heroCta = o.primaryNoop ? '<button class="cta" type="button">Book a table</button>' : '<a class="cta" href="#book">Book a table</a>';
  const canary = o.canaryPort ? `<img src="http://127.0.0.1:${o.canaryPort}/canary.png" width="1" height="1" alt="">` : '';
  const js = `const PAGES = {"/": "Fixture Bistro", "/menu": "Menu — Fixture Bistro"};
const root = document.getElementById("root");
document.documentElement.classList.add("js");
const readPath = () => (location.hash.startsWith("#/") ? location.hash.slice(1).split("#")[0] : "/");
const header = \`<header><a href="#/" class="mark">Fixture Bistro</a>${o.keyboardTrap ? '<input id="trap" aria-label="Search" value="">' : ''}<button class="toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
<nav id="site-nav" class="nav" aria-label="Main"><a href="#/">Home</a><a href="#/menu">Menu</a><a href="#visit">Visit</a>${extraNav}</nav>${o.primaryNoop ? '' : '<a class="cta" href="#book">Book</a>'}</header>\`;
const home = \`<main><section class="hero"><h1>Seasonal plates, slow evenings</h1><p>A small fixture restaurant used to test the verifier.</p>${heroCta}
<img src="/images/hero.png" width="320" height="120" alt="The dining room">${o.brokenImage ? '<img src="/images/missing.png" width="100" height="100" alt="Missing">' : ''}${o.overflow360 ? '<div style="width:350px;height:8px;background:#ddd"></div>' : ''}${o.reducedHidden ? '<span class="spinner" aria-label="Loading"></span>' : ''}${canary}</section>
<div class="filler"></div><section id="visit" data-reveal><h2>Visit</h2><p data-reveal>12 Fixture Lane. <a href="tel:+441234567890">Call us</a> or <a href="https://maps.example.com/">open the map</a>.</p></section>
<section id="book"><h2>Book</h2><form aria-label="Booking enquiry"><label>Name <input name="name" required autocomplete="name"></label><label>Email <input name="email" type="email" required autocomplete="email"></label>
<label>Message <textarea name="message" required></textarea></label><input name="_website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px"><button type="submit">Send enquiry</button><p role="status" id="form-status"></p></form></section></main>${o.fixedBar ? '<div class="promo">Winter offer: two courses for one.</div>' : ''}\`;
const menu = \`<main><h1>Menu</h1><section><h2>Starters</h2><p>Leeks, hazelnut, brown butter.</p></section><p><a href="#/">Back home</a></p></main>\`;
const missing = ${o.unknownBlank ? '"<main></main>"' : '`<main><h1>Page not found</h1><p>That page does not exist.</p><a href="#/">Go home</a></main>`'};
let current = null;
function render() {
  const path = readPath();
  if (path !== current) {
    current = path;
    root.innerHTML = header + (path === "/" ? home : path === "/menu" ? menu : missing);
    document.title = PAGES[path] ?? "Page not found";
    wire();
  }
  const anchor = location.hash.startsWith("#/") ? location.hash.slice(1).split("#")[1] : location.hash.slice(1);
  if (anchor) document.getElementById(anchor)?.scrollIntoView();
}
function wire() {
  const toggle = root.querySelector(".toggle"), nav = root.querySelector("#site-nav");
  const setOpen = open => { nav.classList.toggle("open", open); toggle.setAttribute("aria-expanded", String(open)); };
  ${o.menuNeverOpens ? '' : 'toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));'}
  nav.addEventListener("click", event => { if (event.target.closest("a")) setOpen(false); });
  ${o.menuNoEscape ? '' : 'document.onkeydown = event => { if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") { setOpen(false); toggle.focus(); } };'}
  ${o.keyboardTrap ? 'root.querySelector("#trap").addEventListener("keydown", event => { if (event.key === "Tab") event.preventDefault(); });' : ''}
  ${o.reducedHidden ? 'if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;' : ''}
  const io = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.setAttribute("data-in", ""); io.unobserve(entry.target); } }), { threshold: 0.1 });
  root.querySelectorAll("[data-reveal]").forEach(el => io.observe(el));
  const form = root.querySelector("form");
  if (!form) return;
  const status = form.querySelector("[role=status]"), button = form.querySelector("button");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = new FormData(form);
    const body = JSON.stringify({ requestId: crypto.randomUUID(), name: data.get("name"), email: data.get("email"), message: data.get("message") });
    const send = () => fetch(${o.formOffOrigin ? '"https://collector.example/enquiries"' : '"/_mb/enquiries"'}, { method: "POST", headers: { "Content-Type": "application/json" }, body, credentials: "omit" });
    button.disabled = true;
    try {
      ${o.formTwice ? 'send();' : ''}
      const answer = await (await send()).json();
      ${o.formNoStatus ? '' : 'status.textContent = answer.accepted === true ? "Thanks — your enquiry was sent." : "Your enquiry was not sent. Please try again.";'}
    } catch { ${o.formNoStatus ? '' : 'status.textContent = "Your enquiry was not sent. Please try again.";'} }
    finally { button.disabled = false; }
  });
}
addEventListener("hashchange", render);
render();
${o.runtimeError ? 'setTimeout(() => { throw new Error("fixture boom"); }, 30);' : ''}
${o.canaryPort ? `fetch("http://127.0.0.1:${o.canaryPort}/canary-fetch").catch(() => {}); try { new WebSocket("ws://127.0.0.1:${o.canaryPort}/canary-socket"); } catch {} fetch("/_mb/../canary").catch(() => {}); navigator.sendBeacon?.("http://localhost:${o.canaryPort}/canary-beacon", "x");` : ''}
`;
  return {
    indexHtml: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fixture Bistro</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
    files: [
      {path: '/app.js', contentType: 'text/javascript; charset=utf-8', body: Buffer.from(js)},
      {path: '/app.css', contentType: 'text/css; charset=utf-8', body: Buffer.from(css)},
      {path: '/images/hero.png', contentType: 'image/png', body: PNG},
    ],
  };
}
