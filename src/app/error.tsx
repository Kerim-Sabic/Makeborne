"use client";
import { useEffect } from "react";
import Link from "next/link";
import { reportClientError } from "@/lib/telemetry/client";

/** Fallback for unexpected errors inside a page: report it (scrubbed), offer to retry. */
export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // Server-rendered errors carry a digest and were already recorded by onRequestError (src/instrumentation.ts).
  useEffect(() => { if (!error.digest) reportClientError(error); }, [error]);
  return <main className="app-error" role="alert">
    <h1>Something went wrong on this page.</h1>
    <p>We&apos;ve been notified. Your saved work is safe. Try again, or go back to your studio.</p>
    <div className="app-error-actions">
      <button type="button" className="button primary" onClick={() => retry()}>Try again</button>
      <Link className="button secondary" href="/studio">Open studio</Link>
    </div>
  </main>;
}
