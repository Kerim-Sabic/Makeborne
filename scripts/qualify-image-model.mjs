// No live qualification runs from here. D8 changed on 2026-10-21 (owner, Kerim): the
// gpt-image-2.5 models are bounded by MEASURED_IMAGE_OUTPUT_TOKENS in src/lib/ai/prices.ts
// (observed output tokens per size and quality x 1.5), from the owner-approved research run
// of 2026-10-20 (docs/release-review/design-quality-images-20261020.md). New measurements are
// made only through a budgeted, ledger-reserved research run and then reviewed into prices.ts.
// This command intentionally performs no network calls and reads no API key.
console.error("IMAGE_QUALIFICATION_BLOCKED: this script makes no provider calls. 2.5 bounds come from the reviewed measurements in src/lib/ai/prices.ts (MEASURED_IMAGE_OUTPUT_TOKENS, D8 changed 2026-10-21); record new ones through an approved, ledger-reserved research run.");
process.exitCode = 1;
