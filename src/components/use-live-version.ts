"use client";
import { useEffect, useState } from "react";
import { cloudAccountGuard } from "./cloud-api";

/** What the history list may say about the public site: the live version number,
 * "offline" (never published or taken offline), "error" (couldn't check), or
 * undefined while unknown. Read-only; refreshed each time it is enabled. */
export type LiveVersion = number | "offline" | "error" | undefined;

export function liveVersionFrom(body: unknown): number | "offline" {
  const site = (body as { site?: { live?: unknown; version_number?: unknown } | null } | null)?.site;
  return site && site.live === true && Number.isInteger(site.version_number) ? site.version_number as number : "offline";
}

export function useLiveVersion(accountId: string, workspaceId: string, artifactId: string, enabled: boolean): LiveVersion {
  const scope = `${accountId}:${workspaceId}:${artifactId}`;
  const [state, setState] = useState<{ scope: string; value: Exclude<LiveVersion, undefined> } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const assertAccount = cloudAccountGuard(accountId);
    fetch(`/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/publication`, { cache: "no-store", headers: { "X-Makeborne-Account": accountId }, signal: abort.signal })
      .then(async response => {
        const body = await response.json().catch(() => null);
        assertAccount();
        if (!response.ok) throw new Error("Publishing status is unavailable.");
        if (!abort.signal.aborted) setState({ scope, value: liveVersionFrom(body) });
      })
      .catch(() => { if (!abort.signal.aborted) setState({ scope, value: "error" }); });
    return () => abort.abort();
  }, [enabled, scope, accountId, workspaceId, artifactId]);
  // A value for another project or account is never shown here.
  return enabled && state?.scope === scope ? state.value : undefined;
}
