/**
 * Host-side events for script-free frames (an iframe sandboxed without
 * allow-scripts, which the host reads and decorates through allow-same-origin).
 *
 * Chromium and Firefox run event listeners that the host page adds to such a
 * frame's document or window. WebKit (Safari) runs none: it skips every
 * listener on a document whose frame has scripting disabled, even one created
 * in the host's own realm. Hosts check once per loaded document and, where
 * listeners don't run, take the input in the host page instead. Client-safe.
 */

const PROBE = "makeborne:listener-probe";

/** Whether listeners added to this frame document actually run in this browser. */
export function frameListenersRun(doc: Document): boolean {
  let ran = false;
  const probe = () => { ran = true; };
  try {
    doc.addEventListener(PROBE, probe);
    doc.dispatchEvent(new Event(PROBE));
  } catch { return false; } finally { doc.removeEventListener(PROBE, probe); }
  return ran;
}

/** Calls `onScroll` at most once per animation frame while the frame scrolls: from its
 * scroll event where listeners run, otherwise by watching its scroll position from the
 * host page. Returns a function that stops watching. */
export function watchFrameScroll(view: Window, onScroll: () => void, listenersRun = frameListenersRun(view.document)): () => void {
  let pending = 0;
  const schedule = () => { if (!pending) pending = window.requestAnimationFrame(() => { pending = 0; onScroll(); }); };
  if (listenersRun) {
    view.addEventListener("scroll", schedule, { passive: true });
    return () => { view.removeEventListener("scroll", schedule); window.cancelAnimationFrame(pending); };
  }
  let x = view.scrollX, y = view.scrollY;
  const timer = window.setInterval(() => {
    try {
      if (view.scrollX === x && view.scrollY === y) return;
      x = view.scrollX; y = view.scrollY; schedule();
    } catch { window.clearInterval(timer); }
  }, 150);
  return () => { window.clearInterval(timer); window.cancelAnimationFrame(pending); };
}
