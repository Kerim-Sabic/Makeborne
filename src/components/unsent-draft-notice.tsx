"use client";

/** Says that a brief was restored (and that nothing was sent), with an explicit Discard. */
export default function UnsentDraftNotice({ restoredAt, storageRefused, onDiscard, disabled, className = "" }: {
  restoredAt: number | null; storageRefused: boolean; onDiscard: () => void; disabled?: boolean; className?: string;
}) {
  if (storageRefused) return <p className={`unsent-draft-notice ${className}`} role="status">This browser isn’t keeping a copy of this brief, so a reload would lose it. Keep a copy before leaving the page.</p>;
  if (restoredAt === null) return null;
  const when = new Date(restoredAt), now = new Date();
  const label = when.toDateString() === now.toDateString()
    ? when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : when.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return <p className={`unsent-draft-notice ${className}`} role="status">
    <span>Restored your unsent brief from {label}. Nothing has been sent.</span>
    <button type="button" onClick={onDiscard} disabled={disabled}>Discard brief</button>
  </p>;
}
