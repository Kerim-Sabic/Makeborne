"use client";
import { CheckCircle2, Eye, Globe2, Save } from "lucide-react";
import { versionFacts, type CheckRecord, type LiveFact, type PreviewFact } from "@/lib/hosting/version-facts";
import "@/app/publish-output.css";

/** Saved, checked, live and preview side by side in the website editor header. Read-only: the values come from
 * the editor, this tab's check record, the publication status and the preview's latest build. */
export default function VersionFactsBar({ saved, dirty, checked, live, preview }: { saved: number; dirty: boolean; checked: CheckRecord | null; live: LiveFact; preview?: PreviewFact }) {
  const facts = versionFacts({ saved, dirty, checked, live, preview });
  return <div className="version-facts">
    <ul aria-label="Saved, checked, live and preview versions">
      <li data-fact="saved"><Save size={12} aria-hidden="true" />{facts.saved}</li>
      <li data-fact="checked" data-state={facts.checkedVersion === null ? "none" : facts.checkedVersion < saved ? "older" : "current"} title="The latest search & sharing or colour check of a saved version in this browser tab">
        <CheckCircle2 size={12} aria-hidden="true" />{facts.checked}</li>
      <li data-fact="live" data-state={typeof live === "number" ? "live" : live ?? "unknown"}><Globe2 size={12} aria-hidden="true" />{facts.live}</li>
      <li data-fact="preview" data-state={facts.previewState} title="What the Preview tab shows"><Eye size={12} aria-hidden="true" />{facts.preview}</li>
    </ul>
    <p className="version-facts-notice" role="status">{facts.notice ?? ""}</p>
  </div>;
}
