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

/** Viewports where the project conversation is a sheet under the preview (see build-workspace.css). */
export const CHAT_SHEET_QUERY = "(max-width: 760px)";

/**
 * Escape from inside an open phone conversation sheet (its messages or its
 * toggle) collapses it and returns focus to the toggle. The sheet is an inline
 * disclosure, not a modal: the preview stays visible and usable, so nothing
 * behind it is made inert and focus is not trapped. Escape in the composer is
 * left alone so typing is never interrupted.
 */
export function closeSheetOnEscape(event: { key: string; defaultPrevented: boolean; target: EventTarget | null; currentTarget: EventTarget | null; preventDefault(): void }, open: boolean, close: () => void, messages: string) {
  if (event.key !== "Escape" || !open || event.defaultPrevented || typeof window === "undefined" || !window.matchMedia(CHAT_SHEET_QUERY).matches) return;
  const target = event.target instanceof Element ? event.target : null, sheet = event.currentTarget instanceof Element ? event.currentTarget : null;
  const toggle = sheet?.querySelector<HTMLElement>(".workbench-chat-toggle");
  if (!target || !toggle || !(target === toggle || target.closest(messages))) return;
  event.preventDefault();
  close();
  toggle.focus();
}
