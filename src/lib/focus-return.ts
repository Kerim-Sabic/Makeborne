/**
 * The control a dialog returns focus to when it closes.
 *
 * Safari (WebKit) does not focus a button, link, checkbox or radio when it is
 * clicked, so a dialog opened by a mouse click finds document.activeElement
 * still on <body> and could not give focus back to its opener. One passive
 * capturing listener remembers the most recently pressed control; it is used
 * only when nothing else holds focus. Client-safe (no-op on the server).
 */

const CONTROL = "button, a[href], input, select, textarea, summary, [role='button'], [role='link'], [role='menuitem'], [role='tab'], [tabindex]:not([tabindex='-1'])";
/** A press older than this is not the opener (the dialog opened some other way). */
const RECENT_MS = 10_000;
let pressed: { element: HTMLElement; at: number } | null = null;
let listening = false;

function listen() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("pointerdown", event => {
    const target = event.target instanceof Element ? event.target.closest(CONTROL) : null;
    pressed = target instanceof HTMLElement ? { element: target, at: Date.now() } : null;
  }, { capture: true, passive: true });
}
listen();

/** The focused element, or — where a click left focus on <body> — the control that was just pressed. */
export function focusReturnTarget(): HTMLElement | null {
  listen();
  if (typeof document === "undefined") return null;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement) return active;
  if (pressed && pressed.element.isConnected && Date.now() - pressed.at < RECENT_MS) return pressed.element;
  return null;
}
