"use client";
import { useEffect, useState } from "react";
import { localDateTimeLabel, reviewUtcDateTimeLabel } from "@/lib/client-review/date-format";

/**
 * A moment shown in the reader's own time zone, with the zone named, so a client and the owner read the same
 * expiry the same way. The server and hydration render it in UTC, also named; once the page is live (after its
 * own restores), the browser switches it to local time. Nothing else re-renders.
 */
export default function LocalDateTime({ value }: { value: string }) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setLocal(localDateTimeLabel(value)), 0);
    return () => window.clearTimeout(timer);
  }, [value]);
  return <time dateTime={value}>{local ?? reviewUtcDateTimeLabel(value)}</time>;
}
