"use client";
import { CheckCircle2, Globe2, Save } from "lucide-react";
import { versionFacts, type CheckRecord, type LiveFact } from "@/lib/hosting/version-facts";
import "@/app/publish-output.css";

/** Saved, checked and live side by side in the website editor header. Read-only:
 * the values come from the editor, this tab's check record and the publication status. */
export default function VersionFactsBar({ saved, dirty, checked, live }: { saved: number; dirty: boolean; checked: CheckRecord | null; live: LiveFact }) {
  const facts = versionFacts({ saved, dirty, checked, live });
  return <div className="version-facts">
    <ul aria-label="Saved, checked and live versions">
      <li data-fact="saved"><Save size={12} aria-hidden="true" />{facts.saved}</li>
      <li data-fact="checked" data-state={facts.checkedVersion === null ? "none" : facts.checkedVersion < saved ? "older" : "current"} title="The latest search & sharing or colour check of a saved version in this browser tab">
        <CheckCircle2 size={12} aria-hidden="true" />{facts.checked}</li>
      <li data-fact="live" data-state={typeof live === "number" ? "live" : live ?? "unknown"}><Globe2 size={12} aria-hidden="true" />{facts.live}</li>
    </ul>
    <p className="version-facts-notice" role="status">{facts.notice ?? ""}</p>
  </div>;
}
