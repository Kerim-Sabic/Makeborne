/** Rendered-gate problems that block finish every time they are found (never accepted on a repeat): text hidden under
 * another element, content past the screen edge, a page wider than the screen and a band wrapped onto a second row.
 * The static reduced-motion band rule (quality-gates.ts) blocks the same way. */
export const BLOCKING_PROBLEM = /^(Covered text|Cut off|Page overflow|Wrapped band|Under prefers-reduced-motion \S.* wraps a marquee)/;
