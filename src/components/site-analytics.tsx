"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { analyticsPathAllowed, analyticsPrivacyAllowed, sanitizeAnalyticsEvent } from "@/lib/telemetry/vercel-analytics";

const subscribe = () => () => {};
const serverSnapshot = () => false;
const privacySnapshot = () => analyticsPrivacyAllowed(navigator);
const beforeSend = (event: BeforeSendEvent) => sanitizeAnalyticsEvent(event, navigator);

/** Production-only aggregate page views; existing first-party product telemetry stays separate. */
export default function SiteAnalytics() {
  const pathname = usePathname();
  const permitted = useSyncExternalStore(subscribe, privacySnapshot, serverSnapshot);
  if (!permitted || !pathname || !analyticsPathAllowed(pathname)) return null;
  return <Analytics beforeSend={beforeSend} debug={false} />;
}
