"use client";
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

/** Secondary editor toolbar actions. Wide screens show them inline; under
 * 960px they move into a "More" menu so the toolbar never clips. The children
 * render once, so their own state (a running download) survives resizing. */
export default function WorkbenchMore({ children, label = "More actions" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className="workbench-more" ref={root} data-open={open || undefined}>
    <button ref={toggle} type="button" className="workbench-more-toggle" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(value => !value)}><MoreHorizontal size={16} /></button>
    <div className="workbench-more-panel">{children}</div>
  </div>;
}
