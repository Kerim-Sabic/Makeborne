"use client";
import { useEffect } from "react";
import { reportClientError } from "@/lib/telemetry/client";

/** Last-resort fallback when the root layout itself fails: report it and offer a reload. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { reportClientError(error); }, [error]);
  return <html lang="en"><body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", background: "#f7f6f2", color: "#16181d" }}>
    <main role="alert" style={{ maxWidth: 440, padding: 24, textAlign: "center" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Makeborne hit a problem.</h1>
      <p style={{ margin: "0 0 18px", lineHeight: 1.5 }}>We&apos;ve been notified. Your saved work is safe.</p>
      <button type="button" onClick={() => retry()} style={{ padding: "10px 18px", border: 0, borderRadius: 999, background: "#16181d", color: "#fff", font: "inherit", cursor: "pointer" }}>Try again</button>
    </main>
  </body></html>;
}
