type Format = "website" | "book" | "presentation";
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const formats: Format[] = ["website", "book", "presentation"];
export const wizardDraftKey = (seed: string, kind: Format) => `makeborne.wizard-draft.v1.${kind}.${seed}`;
const activeKey = (seed: string) => `makeborne.wizard-draft.active.v1.${seed}`;

/** The pointer chooses a format only; the caller still validates the full draft. */
export function readWizardDraft(storage: DraftStorage, seed: string, fallback: Format) {
  const active = storage.getItem(activeKey(seed));
  if (active !== null && !formats.includes(active as Format)) throw new Error("Invalid saved draft format.");
  const kind = (active ?? fallback) as Format;
  const raw = storage.getItem(wizardDraftKey(seed, kind));
  if (active !== null && raw === null) throw new Error("The selected saved draft is missing.");
  return { kind, raw };
}

export function writeWizardDraft(storage: DraftStorage, seed: string, kind: Format, raw: string) {
  // Never point at a new format until its actual draft has been preserved.
  storage.setItem(wizardDraftKey(seed, kind), raw);
  storage.setItem(activeKey(seed), kind);
}

export function clearWizardDrafts(storage: DraftStorage, seed: string) {
  // A partial cleanup must not leave a pointer to a deleted draft.
  storage.removeItem(activeKey(seed));
  for (const kind of formats) storage.removeItem(wizardDraftKey(seed, kind));
}
