// Anonymous client side of a client review link on the LOCAL candidate (127.0.0.1:3230): no cookies.
// Usage: node docs/release-review/rc-20261019/review-anonymous.mjs <token>
// Checks: page renders; comment accepted; a wrong token and a cross-site Origin are refused; decision recorded once.
const [token] = process.argv.slice(2);
const origin = "http://127.0.0.1:3230";
const post = (path, body, headers = {}) => fetch(origin + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: JSON.stringify(body) });
const out = {};
const page = await fetch(`${origin}/review/${token}`);
const html = await page.text();
out.page = { status: page.status, mentionsProject: html.includes("Relay Operations"), robots: page.headers.get("x-robots-tag") };
const comment = { version: 2, name: "RC Test Client", email: "", body: "Please make the hero headline shorter.", anchor: { kind: "general" } };
let r = await post(`/api/review/${token}/comments`, comment); out.comment = { status: r.status, body: (await r.text()).slice(0, 200) };
r = await post(`/api/review/${token.slice(0, -2)}xx/comments`, comment); out.wrongToken = { status: r.status, body: (await r.text()).slice(0, 160) };
r = await post(`/api/review/${token}/comments`, comment, { Origin: "https://attacker.example" }); out.crossSite = { status: r.status, body: (await r.text()).slice(0, 160) };
const decision = { version: 2, name: "RC Test Client", email: "", decision: "changes_requested", note: "Shorter hero, please." };
r = await post(`/api/review/${token}/decision`, decision); out.decision = { status: r.status, body: (await r.text()).slice(0, 200) };
r = await post(`/api/review/${token}/decision`, decision); out.decisionRepeat = { status: r.status, body: (await r.text()).slice(0, 200) };
console.log(JSON.stringify(out, null, 2));
