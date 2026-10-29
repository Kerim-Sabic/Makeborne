/* eslint-disable @typescript-eslint/no-require-imports -- Offline launch countdown time math: no clock, network or browser. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const c = require("./countdown.ts");
let count = 0;
const check = (name, fn) => { fn(); count++; console.log("PASS " + name); };
const LAUNCH = Date.parse("2026-10-29T00:30:00Z"), S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

check("default launch is Thursday 29 October 2026, 01:30 Sarajevo (00:30 UTC, CET after the 25 October change)", () => {
  assert.equal(c.parseLaunchAt(undefined), LAUNCH);
  assert.equal(new Date(LAUNCH).getUTCDay(), 4);
  assert.deepEqual(c.launchDateText(LAUNCH), { date: "Thursday 29 October", time: "01:30 CET", short: "Thu 29 Oct" });
  for (const bad of ["", "soon", "28/10/2026", "2026-13-45T99:00:00Z", null]) assert.equal(c.parseLaunchAt(bad), LAUNCH);
  assert.equal(c.parseLaunchAt(" 2026-11-02T09:30:00Z "), Date.parse("2026-11-02T09:30:00Z"));
});

check('only the exact value "on" shows the countdown; unset uses the branch default', () => {
  assert.equal(c.countdownEnabled(undefined), true);
  assert.equal(c.countdownEnabled("on"), true);
  for (const value of ["off", "ON", "true", "1", "", " on"]) assert.equal(c.countdownEnabled(value), false, value);
  assert.equal(c.countdownEnabled(undefined, "off"), false);
});

check('past launch time the screen holds until plans are on sale; only "off" opens regardless', () => {
  assert.equal(c.holdUntilSales(undefined), true);
  for (const value of ["on", "", "OFF", "false", " off"]) assert.equal(c.holdUntilSales(value), true, value);
  assert.equal(c.holdUntilSales("off"), false);
  assert.equal(c.revealReady(true, true), true);
  for (const unknown of [false, null]) assert.equal(c.revealReady(true, unknown), false, String(unknown));
  for (const any of [true, false, null]) assert.equal(c.revealReady(false, any), true, String(any));
  assert.equal(c.HOLD_ANNOUNCEMENT, "Makeborne opens in a moment.");
  const page = fs.readFileSync(path.join(__dirname, "../../app/page.tsx"), "utf8");
  assert.match(page, /launch\.phase === "before" \|\| salesOpen === false/, "a late cut-over keeps the screen up on the server too");
});

check("before, at and after the launch instant, with a 48-hour live window", () => {
  assert.equal(c.launchPhase(LAUNCH - 1, LAUNCH), "before");
  assert.equal(c.launchPhase(LAUNCH, LAUNCH), "live");
  assert.equal(c.launchPhase(LAUNCH + 48 * H - 1, LAUNCH), "live");
  assert.equal(c.launchPhase(LAUNCH + 48 * H, LAUNCH), "after");
  assert.equal(c.LIVE_WINDOW_MS, 48 * H);
});

check("remaining time counts whole seconds rounded up and never goes negative", () => {
  assert.deepEqual(c.remaining(LAUNCH - (2 * D + 4 * H + 12 * M + 5 * S), LAUNCH), { totalMs: 2 * D + 4 * H + 12 * M + 5 * S, totalSeconds: 187925, days: 2, hours: 4, minutes: 12, seconds: 5 });
  assert.equal(c.remaining(LAUNCH - 1, LAUNCH).seconds, 1); // 1 ms left still shows 00:00:01
  assert.equal(c.remaining(LAUNCH - 999, LAUNCH).totalSeconds, 1);
  assert.equal(c.remaining(LAUNCH, LAUNCH).totalSeconds, 0);
  assert.deepEqual(c.remaining(LAUNCH + 5 * H, LAUNCH), { totalMs: 0, totalSeconds: 0, days: 0, hours: 0, minutes: 0, seconds: 0 });
  // Recomputed from the absolute instant: a tab that slept for three hours is exactly right on its next tick.
  const before = c.remaining(LAUNCH - 10 * H, LAUNCH), after = c.remaining(LAUNCH - 7 * H, LAUNCH);
  assert.equal(before.hours - after.hours, 3);
});

check("labels: full minute-precision label, compact banner text and digit cards", () => {
  assert.equal(c.remainingLabel(c.remaining(LAUNCH - (2 * D + 4 * H + 12 * M + 30 * S), LAUNCH)), "2 days, 4 hours, 12 minutes left");
  assert.equal(c.remainingLabel(c.remaining(LAUNCH - (1 * D + 1 * H + 1 * M), LAUNCH)), "1 day, 1 hour, 1 minute left");
  assert.equal(c.remainingLabel(c.remaining(LAUNCH - 3 * H, LAUNCH)), "3 hours left");
  assert.equal(c.remainingLabel(c.remaining(LAUNCH - 59 * S, LAUNCH)), "Less than a minute left");
  assert.equal(c.remainingLabel(c.remaining(LAUNCH, LAUNCH)), "Makeborne is live");
  assert.equal(c.shortRemaining(c.remaining(LAUNCH - (1 * D + 4 * H + 12 * M), LAUNCH)), "1d 4h 12m");
  assert.equal(c.shortRemaining(c.remaining(LAUNCH - (4 * H + 2 * M), LAUNCH)), "4h 2m");
  assert.equal(c.shortRemaining(c.remaining(LAUNCH - (12 * M + 5 * S), LAUNCH)), "12m 05s");
  assert.equal(c.shortRemaining(c.remaining(LAUNCH - 9 * S, LAUNCH)), "9s");
  assert.deepEqual(c.digits(4), ["0", "4"]);
  assert.deepEqual(c.digits(123), ["1", "2", "3"]);
  assert.deepEqual(c.digits(-3), ["0", "0"]);
});

check("the live region changes only at hour boundaries, then at minute boundaries in the final hour", () => {
  const said = new Set();
  for (let t = LAUNCH - 5 * H; t < LAUNCH - H; t += 7 * S) said.add(c.announcement(c.remaining(t, LAUNCH)));
  assert.deepEqual([...said], ["5 hours until launch.", "4 hours until launch.", "3 hours until launch.", "2 hours until launch."]);
  const minutes = new Set();
  for (let t = LAUNCH - H; t < LAUNCH; t += 5 * S) minutes.add(c.announcement(c.remaining(t, LAUNCH)));
  assert.equal(minutes.size, 60);
  assert.equal(c.announcement(c.remaining(LAUNCH - 26 * H, LAUNCH)), "1 day, 2 hours until launch.");
  assert.equal(c.announcement(c.remaining(LAUNCH - 30 * S, LAUNCH)), "1 minute until launch.");
  assert.equal(c.announcement(c.remaining(LAUNCH, LAUNCH)), "Makeborne is live.");
});

check("ticks land on whole seconds (or minutes) and never sleep past the launch instant", () => {
  assert.equal(c.nextTickDelay(LAUNCH - 10 * S + 250, 1000), 762);
  assert.equal(c.nextTickDelay(LAUNCH - 10 * M + 1000, 60000), 59012);
  // Reduced motion ticks once a minute, but the switch to "We're live" still happens on time.
  assert.equal(c.nextTickDelay(LAUNCH - 20 * S, 60000, LAUNCH), 20012);
  assert(c.nextTickDelay(LAUNCH, 1000) >= 16);
});

check("clock skew: halfway through the round trip; small differences are trusted, big ones corrected", () => {
  const client = LAUNCH - H;
  assert.equal(c.clockOffset({ sentAt: client, receivedAt: client + 400, serverNow: client + 200 + 900 }), 0); // 0.9 s off: trusted
  assert.equal(c.clockOffset({ sentAt: client, receivedAt: client + 400, serverNow: client + 200 + 2 * H }), 2 * H); // client 2 h slow
  assert.equal(c.clockOffset({ sentAt: client, receivedAt: client + 400, serverNow: client + 200 - 3 * D }), -3 * D); // client 3 days fast
  assert.equal(c.clockOffset({ sentAt: client, receivedAt: client - 5, serverNow: client }), 0); // clock moved backwards mid-request
  assert.equal(c.clockOffset({ sentAt: client, receivedAt: client + 10, serverNow: NaN }), 0);
  assert.equal(c.dateHeaderTime("Thu, 29 Oct 2026 00:30:00 GMT"), LAUNCH);
  assert(Number.isNaN(c.dateHeaderTime(null)));
  assert.equal(c.PAGE_SKEW_TOLERANCE_MS, 60000);
});

check("time zones: Sarajevo name follows DST; the visitor's own time is shown only when it differs", () => {
  assert.equal(c.launchDateText(Date.parse("2026-10-24T17:00:00Z")).time, "19:00 CEST"); // still summer time on 24 October
  assert.equal(c.launchDateText(Date.parse("2026-10-25T18:00:00Z")).time, "19:00 CET"); // the change was 25 October 03:00
  assert.equal(c.zoneOffsetMinutes(LAUNCH, "Europe/Sarajevo"), 60);
  assert.equal(c.zoneOffsetMinutes(LAUNCH, "America/New_York"), -240); // US still on EDT until 1 November
  assert.equal(c.zoneOffsetMinutes(LAUNCH, "Asia/Kolkata"), 330);
  assert.equal(c.localLaunchText(LAUNCH, "Europe/Sarajevo", "en-GB"), null);
  assert.equal(c.localLaunchText(LAUNCH, "Europe/Berlin", "en-GB"), null); // same offset reads the same
  assert.equal(c.localLaunchText(LAUNCH, "Europe/London", "en-GB"), "0:30 in your time");
  assert.equal(c.localLaunchText(LAUNCH, "America/New_York", "en-US"), "Wed 8:30 PM in your time"); // previous evening;
  assert.equal(c.localLaunchText(LAUNCH, "Asia/Tokyo", "en-GB"), "9:30 in your time")
  assert.equal(c.localLaunchText(LAUNCH, "Pacific/Auckland", "en-GB"), "13:30 in your time");
  assert.equal(c.localLaunchText(LAUNCH, "Not/AZone", "en-GB"), null);
  assert.equal(c.localLaunchText(LAUNCH, undefined), null);
});

check("test override parsing (the server allows it only outside production)", () => {
  assert.equal(c.countdownOverride("at:2026-10-26T12:00:00Z"), Date.parse("2026-10-26T12:00:00Z"));
  assert.equal(c.countdownOverride(["at:2026-10-26T12:00:00Z", "x"]), Date.parse("2026-10-26T12:00:00Z"));
  for (const bad of [undefined, "", "2026-10-26T12:00:00Z", "at:", "at:never"]) assert.equal(c.countdownOverride(bad), null);
  const config = fs.readFileSync(path.join(__dirname, "config.ts"), "utf8");
  assert.match(config, /testOverrides: process\.env\.VERCEL_ENV !== "production" && process\.env\.VERCEL_TARGET_ENV !== "production"/);
  assert.match(config, /const forced = config\.testOverrides \? countdownOverride\(override\) : null/);
});

check("honesty: after launch the copy never claims checkout is open unless the server says plans are on sale", () => {
  assert.deepEqual(c.liveCopy(true), { headline: "We're live", cta: "See plans", note: null });
  assert.deepEqual(c.liveCopy(false), { headline: "We're live", cta: null, note: "Plans opening any moment" });
  assert.deepEqual(c.liveCopy(null), { headline: "We're live", cta: null, note: null });
  const route = fs.readFileSync(path.join(__dirname, "../../app/api/launch-status/route.ts"), "utf8");
  assert.match(route, /salesOpenNow\(\)/);
  assert.match(route, /"Cache-Control": "no-store"/);
  // The sales answer is the checkout's own gate on each branch: the env gate on main, the database plan gate in the release.
  const gate = fs.readFileSync(path.join(__dirname, "sales-open.ts"), "utf8");
  assert.match(gate, /billingConfig\(\)\.enabled|plansOnSale\(\)/);
  // The countdown code never touches checkout or sales switches.
  for (const file of ["countdown.ts", "config.ts", "../../components/launch/launch-screen.tsx", "../../components/launch/launch-banner.tsx", "../../components/launch/plans-open-line.tsx", "../../components/launch/use-launch-clock.ts", "../../components/launch/roll-clock.tsx", "../../components/launch/waitlist-form.tsx"]) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.doesNotMatch(source, /WHOP_CREATION_ENABLED\s*=|checkout\(|\/api\/billing\/checkout/, file);
  }
});

check("sneak-peek imagery: whole website designs, unlabelled, neutral descriptions, no product claims, off-centre windows, a fresh order per visit", () => {
  const concepts = require("../../components/launch/concepts.ts");
  assert(concepts.CONCEPTS.length >= 8 && concepts.CONCEPTS.length <= 12);
  for (const concept of concepts.CONCEPTS) {
    assert.doesNotMatch(concept.alt, /makeborne|example|output|made with|ai-generated|concept/i, concept.alt);
    assert.match(concept.alt, /website design$/, "every peek is a website");
    const file = path.join(__dirname, "../../../public", concepts.conceptSrc(concept, "site"));
    const kb = fs.statSync(file).size / 1024;
    assert(kb <= 170, `${file} is ${kb.toFixed(0)} KB`);
  }
  const folder = path.join(__dirname, "../../../public/launch/concepts");
  assert.deepEqual(fs.readdirSync(folder).filter(name => !name.endsWith("-site.webp")), [], "no prompts, logs, source PNGs or unused sizes");
  assert.equal(fs.readdirSync(folder).length, concepts.CONCEPTS.length);
  assert(concepts.WINDOW_SPOTS.length >= 4);
  for (const [x, y] of concepts.WINDOW_SPOTS) assert(Math.abs(x - 0.5) >= 0.3 && x >= 0 && x <= 1 && y >= 0 && y <= 1, `window at ${x},${y} sits off-centre, on screen`);
  for (let i = 1; i < concepts.WINDOW_SPOTS.length; i++) assert((concepts.WINDOW_SPOTS[i][0] < 0.5) !== (concepts.WINDOW_SPOTS[i - 1][0] < 0.5), "the next site is on the other side");
  let seed = 7; const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const order = concepts.shuffledConcepts(random);
  assert.deepEqual([...order].map(item => item.id).sort(), concepts.CONCEPTS.map(item => item.id).sort(), "a permutation");
  assert.notDeepEqual(order.map(item => item.id), concepts.CONCEPTS.map(item => item.id));
  const sources = ["launch-screen.tsx", "launch-backdrop.tsx", "sound-toggle.tsx"].map(file => fs.readFileSync(path.join(__dirname, "../../components/launch", file), "utf8")).join("\n");
  assert.doesNotMatch(sources.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /made with makeborne|ai-generated|style concepts/i, "no caption in the markup");
});

check("nothing appears on its own: no ambient drift, peek hint or secret gallery; sound is opt-in, synthesised and capped", () => {
  const read = file => fs.readFileSync(path.join(__dirname, "../../components/launch", file), "utf8");
  const backdrop = read("launch-backdrop.tsx"), screen = read("launch-screen.tsx"), sound = read("launch-sound.ts"), toggle = read("sound-toggle.tsx");
  assert.doesNotMatch(backdrop + screen, /mbl-ambient|Hold to peek|useSecretWord|ConceptGallery|setInterval/);
  assert.match(backdrop, /addEventListener\("pointermove"/);
  assert.match(backdrop, /addEventListener\("touchmove", touchMove, \{ passive: false \}\)/, "a held drag owns its gesture");
  assert.match(backdrop, /closest\("a,button,input,label,form"\)/, "taps on the form and links are never captured");
  assert.match(toggle, /=== "on"/, "off unless the visitor turned it on");
  assert.match(toggle, /addEventListener\("pointerdown", start, \{ once: true \}\)/, "a remembered choice waits for a gesture");
  assert.match(sound, /const CEILING = 0\.22;/);
  assert.match(sound, /createDynamicsCompressor\(\)/);
  assert.doesNotMatch(sound, /\.mp3|\.wav|\.ogg|fetch\(/, "synthesised: no audio files");
  assert.match(toggle, /soundPause\(hidden\)/);
});

console.log(count + " launch countdown groups passed; no clock, network or browser");
