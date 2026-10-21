"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { focusReturnTarget } from "@/lib/focus-return";

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
    <div className={`mc-sheet${wide ? " pq" : ""}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={sheet} onKeyDown={event => { if (event.key === "Escape" && !locked) { event.stopPropagation(); onClose(); } }}>
      {children}
    </div>
  </div>, document.body);
}
