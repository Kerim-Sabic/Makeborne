"use client";
import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { cloudAccountGuard } from "./cloud-api";

export default function WebsiteSourceDownload({accountId, workspaceId, artifactId, version, disabled}: {
  accountId: string; workspaceId: string; artifactId: string; version: number; disabled: boolean;
}) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function download() {
    if (disabled || inFlight.current || version < 1) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const checkAccount = cloudAccountGuard(accountId);
      checkAccount();
      const response = await fetch(`/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/source?version=${version}`, {
        cache: "no-store", credentials: "same-origin", headers: {"X-Makeborne-Account": accountId},
      });
      checkAccount();
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error?.message || "Website source could not be downloaded.");
      }
      if (response.headers.get("Content-Type") !== "application/zip") throw new Error("The download did not return a website archive.");
      const blob = await response.blob();
      checkAccount();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `makeborne-website-v${version}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`Saved version ${version} downloaded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Website source could not be downloaded.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return <div>
    <button type="button" disabled={disabled || busy || version < 1} onClick={() => void download()} title={disabled ? "Save and resolve pending changes before downloading source." : `Download saved version ${version}`}>
      <Download size={15} />{busy ? "Downloading…" : "Download source"}
    </button>
    {message && <span className="small-note" role="status">{message}</span>}
  </div>;
}
