/**
 * Which presenter shortcut a key press means, if any (audit F14). Shortcuts
 * belong to the slide canvas: a focused button, link, field or widget keeps its
 * native keys, so Enter/Space on "Previous slide" or "Exit presentation"
 * activates that button instead of advancing. Works for events from the host
 * page and from the slide frame (another document), so no instanceof checks.
 * Client-safe.
 */

export type PresenterAction = "next" | "previous" | "first" | "last" | "close";
type KeyLike = { key: string; defaultPrevented: boolean; isComposing?: boolean; keyCode?: number; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; target: unknown };
type ElementLike = { tagName?: string; getAttribute?: (name: string) => string | null; isContentEditable?: boolean; closest?: (selector: string) => unknown };

const ACTIVATES = new Set(["Enter", " "]);
const CONTROL_SELECTOR = "a[href], button, input, select, textarea, summary, [contenteditable]:not([contenteditable='false']), [role='button'], [role='link'], [role='slider'], [role='spinbutton'], [role='textbox'], [role='listbox'], [role='combobox'], [role='menu'], [role='menuitem'], [role='option'], [role='tab'], [role='switch'], [role='checkbox'], [role='radio'], [role='dialog']";
// Widgets that use arrow/Home/End/Backspace themselves (fields, sliders, lists, menus).
const KEY_WIDGET_SELECTOR = "input, select, textarea, [contenteditable]:not([contenteditable='false']), [role='slider'], [role='spinbutton'], [role='textbox'], [role='listbox'], [role='combobox'], [role='menu'], [role='menuitem'], [role='option'], [role='tab'], [role='radiogroup']";

/** The interactive control the event started in, if any (the presenter root itself is not one). */
function control(target: unknown, selector: string): boolean {
  const element = target as ElementLike | null;
  if (!element || typeof element.closest !== "function") return false;
  const found = element.closest(selector) as ElementLike | null;
  return !!found && found.getAttribute?.("data-presenter-root") === null;
}

export function presenterShortcut(event: KeyLike): PresenterAction | null {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return null;
  if (event.key === "Escape") return "close";
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  // Native activation of a focused control wins over "next slide".
  if (ACTIVATES.has(event.key) && control(event.target, CONTROL_SELECTOR)) return null;
  if (control(event.target, KEY_WIDGET_SELECTOR)) return null;
  if (event.key === " ") return event.shiftKey ? "previous" : "next";
  if (event.shiftKey) return null;
  switch (event.key) {
    case "ArrowRight": case "ArrowDown": case "PageDown": case "Enter": return "next";
    case "ArrowLeft": case "ArrowUp": case "PageUp": case "Backspace": return "previous";
    case "Home": return "first";
    case "End": return "last";
    default: return null;
  }
}

/** Click-to-advance on the slide: not when the click was on a link/control or ended a text selection. */
export function advancesOnClick(target: unknown, selectedText: string): boolean {
  return !selectedText.trim() && !control(target, CONTROL_SELECTOR);
}
