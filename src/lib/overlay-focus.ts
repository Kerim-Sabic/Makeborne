/** Viewports where the studio navigation is an opaque drawer over the page, not a side rail. */
export const DRAWER_NAVIGATION_QUERY = "(max-width: 700px)";

/** Elements that can take keyboard focus, in document order. Hidden, disabled and inert controls are left out. */
export const FOCUSABLE_SELECTOR = "a[href],button,input,textarea,select,summary,[tabindex]";

/**
 * Where Tab should land while focus must stay inside an open overlay.
 * Returns null when the browser's own sequential move already stays inside.
 */
export function overlayTabTarget<T>(nodes: readonly T[], current: T | null, backwards: boolean): T | null {
  if (!nodes.length) return null;
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (current === null || !nodes.includes(current)) return backwards ? last : first;
  if (backwards && current === first) return last;
  if (!backwards && current === last) return first;
  return null;
}

/**
 * After an overlay closes, focus returns to its opener unless the user already
 * moved it somewhere meaningful outside the overlay (for example a chosen route).
 */
export function shouldRestoreOverlayFocus(activeInsideOverlay: boolean, activeIsBody: boolean) {
  return activeInsideOverlay || activeIsBody;
}
