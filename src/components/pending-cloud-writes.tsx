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
        "Retry this exact saved request? The server will return its original result if it already completed.",
      )
    )
      return;
    setBusy(true);
    try {
      await api(item.path, JSON.parse(item.body), "POST");
      await refresh();
      scan();
      setMessage(
        "The exact request was confirmed. Review the current cloud records before continuing any incomplete import.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The request is still unconfirmed. Its original identity has been preserved.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!pending.length) return null;
  return (
    <section className="cloud-conflict">
      <span className="eyebrow">PENDING CLOUD OPERATIONS ON THIS DEVICE</span>
      <h3>Keep uncertain work recoverable.</h3>
      <p>
        These requests have a preserved identity. They are never retried
        automatically. A content-save draft should be reviewed in its editor
        before saving again.
      </p>
      {pending.map((item) => {
        let label = "Cloud write";
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
                    : item.path.endsWith("/projects")
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
                Download pending request
              </button>
              {!version && (
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => retry(item)}
                >
                  Retry exact request
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
