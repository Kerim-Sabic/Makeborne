"use client";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { focusReturnTarget } from "@/lib/focus-return";
import { FOCUSABLE_SELECTOR, overlayTabTarget } from "@/lib/overlay-focus";

/** Tab and Shift+Tab wrap inside the open dialog (aria-modal), so keyboard focus never moves to the page behind it. */
function keepFocusInside(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Tab") return;
  const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(node =>
    !node.matches(":disabled,[aria-disabled='true']") && node.tabIndex >= 0 && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden");
  const target = overlayTabTarget(nodes, document.activeElement as HTMLElement | null, event.shiftKey);
  if (target) { event.preventDefault(); target.focus(); }
}

/** Dialog rendered at the top of the page (above the studio sidebar), with Escape, focus and backdrop handling. */
export default function Modal({ label, onClose, locked = false, wide = false, children }: { label: string; onClose: () => void; locked?: boolean; wide?: boolean; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = focusReturnTarget();
    sheet.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; previous?.focus?.(); };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(<div className="mc-modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !locked) onClose(); }}>
    <div className={`mc-sheet${wide ? " pq" : ""}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={sheet} onKeyDown={event => { if (event.key === "Escape" && !locked) { event.stopPropagation(); onClose(); return; } keepFocusInside(event); }}>
      {children}
    </div>
  </div>, document.body);
}
