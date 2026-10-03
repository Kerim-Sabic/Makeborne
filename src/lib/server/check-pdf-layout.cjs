/* eslint-disable @typescript-eslint/no-require-imports -- Explicit localhost visual export fixture generator. */
const fs = require("node:fs/promises"), path = require("node:path"), { randomUUID } = require("node:crypto");
if (process.env.MAKEBORNE_VERIFY_EXPORT_HTTP !== "true") throw new Error("Set MAKEBORNE_VERIFY_EXPORT_HTTP=true for localhost fixture exports.");
const output = path.resolve("../pdf-layout-checks");
const block = (type, text) => ({ id: randomUUID(), type, text });
const paragraph = "A strong client project starts with listening. Ask what success means, who will use the finished work, and what information is already approved. Keep the brief specific enough to guide decisions, while leaving room for a thoughtful visual direction. Record open questions instead of presenting assumptions as facts.";
const bookBlocks = [block("heading", "Begin with a clear brief"), ...Array.from({ length: 7 }, (_, i) => block("paragraph", `${i + 1}. ${paragraph}`)), block("quote", "Good work makes the next decision easier."), block("heading", "Build a useful first version"), ...Array.from({ length: 5 }, (_, i) => block("paragraph", `${i + 8}. ${paragraph}`)), block("heading", "Review before sharing"), block("paragraph", "Final checkpoint: every supplied paragraph remains present. Check layout, source accuracy, links and permissions before release.")];
const fixtures = [
  { name: "editorial-book", kind: "book", title: "The Thoughtful Client Guide", style: { id: "editorial", name: "Editorial", font: "serif", color: "#45665A", background: "#F8F7F4", textColor: "#242A26" }, blocks: bookBlocks },
  { name: "dark-book", kind: "book", title: "A Different Point of View", style: { id: "electric-mint", name: "Electric Mint", font: "sans", color: "#8FEBC8", background: "#142824", textColor: "#F0FAF4" }, blocks: bookBlocks },
  { name: "native-presentation", kind: "presentation", title: "A thoughtful client proposal", style: { id: "venture", name: "Venture", font: "sans", color: "#536AC6", background: "#F5F7FC", textColor: "#202C45" }, blocks: [block("heading", "Make the next step clear"), block("paragraph", "An editable proposal built around the client’s actual needs."), block("heading", "A considered approach"), block("paragraph", "01  Understand the audience\n\n02  Agree the scope and source material\n\n03  Create a useful first version\n\n04  Review the result together"), block("heading", "Ready for a real conversation"), block("paragraph", "Confirm the brief. Resolve the open questions. Choose the next action.")] },
];
void (async () => {
  await fs.mkdir(output, { recursive: true });
  for (const { name, ...fixture } of fixtures) {
    const response = await fetch("http://127.0.0.1:3000/api/export", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000" }, body: JSON.stringify({ ...fixture, styleId: fixture.style.id, format: "pdf", author: "Makeborne QA", language: "en", presentationMode: "native" }) });
    if (!response.ok) throw new Error(`${name}: ${response.status} ${await response.text()}`);
    await fs.writeFile(path.join(output, `${name}.pdf`), Buffer.from(await response.arrayBuffer()));
    console.log(`Created ${path.join(output, `${name}.pdf`)}`);
  }
  const oversized = await fetch("http://127.0.0.1:3000/api/export", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000" }, body: JSON.stringify({ kind: "presentation", format: "pdf", title: "Overflow fixture", blocks: [block("heading", "Overfull slide"), block("paragraph", "Long supplied content. ".repeat(200))] }) });
  const problem = await oversized.json();
  if (oversized.status !== 400 || problem.error?.code !== "SLIDE_CONTENT_OVERFLOW") throw new Error("Oversized slide was not rejected with the expected overflow error.");
  console.log("PASS oversized PDF slide is rejected rather than clipped.");
})().catch(error => { console.error(error.message); process.exitCode = 1; });
