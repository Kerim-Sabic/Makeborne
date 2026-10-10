"use client";
import { useEffect, useState } from "react";
import {
  api,
  getPendingCloudWrites,
  type PendingCloudWrite,
} from "./cloud-api";
export default function PendingCloudWrites({
  accountId,
  refresh,
}: {
  accountId: string;
  refresh: () => Promise<void>;
}) {
  const [pending, setPending] = useState<PendingCloudWrite[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function scan() {
    setPending(getPendingCloudWrites(accountId));
  }
  useEffect(() => {
    const update = () => setPending(getPendingCloudWrites(accountId));
    queueMicrotask(update);
    window.addEventListener("makeborne-cloud-pending", update);
    return () => window.removeEventListener("makeborne-cloud-pending", update);
  }, [accountId]);
  function download(item: PendingCloudWrite) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(item, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "makeborne-pending-cloud-write.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function retry(item: PendingCloudWrite) {
    if (busy) return;
    if (
      !window.confirm(
        "Try saving this again? If it already went through, nothing will be duplicated.",
      )
    )
      return;
    setBusy(true);
    try {
      await api(item.path, JSON.parse(item.body), "POST");
      await refresh();
      scan();
      setMessage(
        "Saved. Check your projects to make sure everything looks right.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "We still couldn't confirm this save. A copy is kept on this device so you can try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!pending.length) return null;
  return (
    <section className="cloud-conflict">
      <span className="eyebrow">SAVES AWAITING CONFIRMATION</span>
      <h3>Some changes may not have saved.</h3>
      <p>
        We couldn&apos;t confirm these saves, so a copy is kept on this device.
        Nothing is retried automatically. For content changes, open the
        project and review them in the editor before saving again.
      </p>
      {pending.map((item) => {
        let label = "Unsaved change";
        try {
          const body = JSON.parse(item.body);
          label = String(
            body.title || body.name || body.content?.title || label,
          );
        } catch {
          /* Preserve unreadable request. */
        }
        const version = item.path.endsWith("/versions");
        return (
          <article className="pending-cloud-item" key={item.storageId}>
            <strong>{label}</strong>
            <p>
              {version
                ? "Content version save"
                : item.path === "/api/workspaces"
                  ? "Workspace creation"
                  : item.path.endsWith("/clients")
                    ? "Client creation"
                    : item.path.endsWith("/projects") || item.path.endsWith("/studio-projects")
                      ? "Project creation"
                      : "Content setup"}{" "}
              ·{" "}
              {item.createdAt
                ? new Date(item.createdAt).toLocaleString()
                : "Unknown time"}
            </p>
            <div className="button-row">
              <button
                className="button secondary small"
                onClick={() => download(item)}
              >
                Download a copy
              </button>
              {!version && (
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => retry(item)}
                >
                  Try saving again
                </button>
              )}
            </div>
          </article>
        );
      })}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
