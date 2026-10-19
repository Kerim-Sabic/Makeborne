// The numbers from docs/execution/QUALITY_BAR.md (version 1.3, 2026-10-18; thresholds unchanged since 1) as
// data, so every instrument, summary and test judges against one source.
// Tier: L blocks launch, C blocks the public "better than" claim, F follows.
export const QUALITY_BAR_VERSION = '1.3 (2026-10-18)';

export const WIDTHS = Object.freeze([360, 390, 820, 1440]);
export const HEIGHTS = Object.freeze({ 360: 780, 390: 844, 820: 1180, 1440: 900 });
export const FIRST_SCREENS = Object.freeze([{ width: 390, height: 844 }, { width: 1440, height: 900 }]);

export const WEBSITE = Object.freeze({
  W1: { label: 'Compiles', tier: 'L', site: 'no bundler error', set: 1.0 },
  W2: { label: 'Type-checks', tier: 'F', site: '0 TypeScript errors', set: 0.9 },
  W3: { label: 'Lighthouse accessibility', tier: 'L', min: 95, set: 0.9 },
  W4: { label: 'Lighthouse performance', tier: 'L', min: 90, claimMin: 95, set: 0.9 },
  W5: { label: 'Lighthouse SEO and best practices', tier: 'F', min: 90, set: 0.9 },
  W6: { label: 'axe critical / serious', tier: 'L', critical: 0, serious: 0, setCritical: 1.0, setSerious: 0.9 },
  W7: { label: 'CLS', tier: 'L', max: 0.1, set: 1.0 },
  W8: { label: 'LCP (lab, mobile)', tier: 'C', maxMs: 2500, set: 0.9 },
  W9: { label: 'Horizontal overflow', tier: 'L', maxPx: 0, set: 1.0 },
  W10: { label: 'Text contrast', tier: 'L', maxFailing: 0, set: 0.95, siteCeiling: 3 },
  W11: { label: 'Valid HTML', tier: 'F', maxErrors: 0, set: 0.9 },
  W12: { label: 'Weight', tier: 'F', maxTotalKiB: 1600, maxJsKiB: 300, set: 0.9 },
  W13: { label: 'Dead links', tier: 'L', max: 0, set: 1.0 },
  W14: { label: 'Images', tier: 'L', maxBroken: 0, maxMissingAlt: 0, maxMissingDims: 1, set: 1.0, setDims: 0.9 },
  W15: { label: 'Template tells', tier: 'C', maxTells: 1, set: 0.9, maxCreamSerifItalicPill: 1 },
  W16: { label: 'First screen', tier: 'C', set: 1.0 },
  W17: { label: 'Honest content', tier: 'L', set: 1.0 },
});

export const DIVERSITY = Object.freeze({
  D1: { label: 'Distinct palettes', tier: 'C', deltaE: 10, minClustersPer20: 14, maxPerCluster: 3 },
  D2: { label: 'Ground spread', tier: 'C', maxWarmLightShare: 0.35, minClasses: 4 },
  D3: { label: 'Distinct type pairings', tier: 'C', minPer20: 12, maxPerPairing: 3 },
  D4: { label: 'First-screen archetypes', tier: 'C', maxShare: 0.4, maxCentredShare: 0.1, named: ['photographic', 'type-as-image', 'editorial-split', 'poster', 'product-stage', 'index'] },
  D5: { label: 'Diversity index', tier: 'C', min: 0.85 },
});

export const DOCUMENTS = Object.freeze({
  P1: { label: 'PPTX editable-text rate (visible, in order)', tier: 'L', min: 0.95 },
  P2: { label: 'Native charts (data matches)', tier: 'L', min: 1.0 },
  P3: { label: 'Per-slide overflow', tier: 'L', max: 0 },
  P4: { label: "Current fit warnings (today's composer)", tier: 'C', max: 0 },
  P5: { label: 'Layout rotation', tier: 'C', max: 0 },
  P6: { label: 'Speaker notes (in the PPTX)', tier: 'F', min: 0.9 },
  K1: { label: 'KDP interior preflight (validator + harness checks)', tier: 'L', maxErrors: 0 },
  K2: { label: 'KDP cover geometry', tier: 'L', toleranceIn: 0.001 },
  K3: { label: 'Book overflow', tier: 'L', max: 0 },
});

export const JUDGE = Object.freeze({
  J1: { label: 'Win rate vs each competitor', tier: 'C', ciLowerAbove: 0.5, resamples: 10_000, seed: 20261018 },
  J2: { label: 'Round on round', tier: 'C', ciLowerAbove: 0.5 },
  J3: { label: 'Human designers', tier: 'C', minShare: 0.6 },
  J4: { label: 'Judge sanity', tier: 'gate', minAgreement: 0.95, positionBiasBand: [0.4, 0.6] },
});

export const STUDIO = Object.freeze({
  S2: { label: 'axe on studio pages', critical: 0, serious: 0 },
  S3: { label: 'Studio text contrast (audit script)', max: 0, auditBaseline: 38 },
  S4: { label: 'Studio web vitals', clsMax: 0.1, lcpMaxMs: 2500 },
  S5: { label: 'Studio layout', overflowPx: 0, toolbarClipped: false },
});

// Copy that prompt.ts bans as filler; matched case-insensitively on visible text.
export const BANNED_COPY = Object.freeze([
  'lorem ipsum', 'welcome to', 'elevate', 'unlock', 'empower', 'seamless', 'revolutionise', 'revolutionize', 'cutting-edge',
  'your journey starts here', 'learn more', 'click here', 'submit',
]);
// Headings that are only labels (prompt.ts COPY rule).
export const LABEL_HEADINGS = Object.freeze(['our services', 'about us', 'why choose us', 'services', 'about', 'contact us', 'testimonials']);
