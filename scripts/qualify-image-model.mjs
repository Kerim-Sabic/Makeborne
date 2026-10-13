// Disabled until the provider offers a documented maximum cost or an enforced
// per-request output/cost limit. A sample measurement is not a spending bound.
// This command intentionally performs no network calls and reads no API key.
console.error("IMAGE_QUALIFICATION_BLOCKED: observed token counts, another model's counts, and statistical headroom cannot guarantee the approved spending cap. Keep images off until a provider-enforced bound is verified.");
process.exitCode = 1;
