"use client";
import { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { readCloudImage } from "./cloud-api";

export type ArtworkScope = { accountId: string; workspaceId: string; artifactId: string };
export default function AccountArtwork({ scope, assetId, caption }: { scope: ArtworkScope; assetId: string; caption: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; url?: string; error?: string } | null>(null);
  const path = `/api/cloud/workspaces/${scope.workspaceId}/artifacts/${scope.artifactId}/assets/${assetId}`;
  const key = `${scope.accountId}:${path}:${attempt}`;
  const accountId = scope.accountId;
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    let url: string | undefined;
    const timeout = setTimeout(() => abort.abort(), 30_000);
    void readCloudImage(path, accountId, abort.signal).then(blob => {
      if (!active || abort.signal.aborted) return;
      url = URL.createObjectURL(blob); setResult({ key, url });
    }).catch(() => { if (active) setResult({ key, error: "Artwork could not be loaded." }); })
      .finally(() => { clearTimeout(timeout); });
    return () => { active = false; clearTimeout(timeout); abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [key, path, accountId]);
  const current = result?.key === key ? result : null;
  return <figure className={current?.url ? "ap-artwork" : "ap-placeholder"}>
    {current?.url ? <>
      {/* Authenticated, temporary blob URL must not enter a public image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={current.url} alt={caption || "Project artwork"} onError={() => setResult({ key, error: "Artwork could not be displayed." })} />
    </> : <><ImageIcon size={24} /><small role="status">{current?.error ?? "Loading artwork…"}</small>{current?.error && <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}</>}
    {caption && <figcaption>{caption}</figcaption>}
  </figure>;
}
