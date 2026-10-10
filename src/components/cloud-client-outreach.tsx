"use client";
import { useState } from "react";
import type { CloudClient } from "@/lib/cloud/contracts";
import ClientOutreachPanel from "./client-outreach";
import { api } from "./cloud-api";
import "@/app/client-workspace.css";

export default function CloudClientOutreach({ initialClient, workspaceId, canEdit, onSaved, close, onSaving }: {
  onSaving?: (value: boolean) => void;
  initialClient: CloudClient; workspaceId: string; canEdit: boolean;
  onSaved: (client: CloudClient) => void; close: () => void;
}) {
  const [client, setClient] = useState(initialClient);
  const [busy, setBusy] = useState(false);
  return <section className="import-review" aria-label={`Outreach for ${client.name}`}>
    <div className="cw-section-heading"><div><span className="eyebrow">CLIENT OUTREACH</span><h2>{client.name}</h2></div>
      <button type="button" className="button secondary small" disabled={busy} onClick={close}>Close outreach</button></div>
    <ClientOutreachPanel client={client} storageLabel="to your account" readOnly={!canEdit}
      onSave={async updated => {
        setBusy(true); onSaving?.(true);
        try {
          const result = await api<{ client: CloudClient }>(`/api/cloud/workspaces/${workspaceId}/clients/${client.id}`, {
            outreach: updated.outreach, expectedUpdatedAt: client.updatedAt,
          }, "PATCH");
          setClient(result.client); onSaved(result.client); return true;
        } finally { setBusy(false); onSaving?.(false); }
      }} />
    <p className="small-note">If these details were changed somewhere else at the same time, your draft is kept. Copy your edits, then reload the workspace to see the latest version.</p>
  </section>;
}
