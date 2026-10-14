type KeyedStorage = Pick<Storage, "length" | "key" | "getItem" | "removeItem">;

function ownedByAccount(storage: KeyedStorage, key: string, accountId: string) {
  if (!key.startsWith("makeborne")) return false;
  if ([
    `makeborne.cloud-draft.${accountId}.`,
    `makeborne.generation.v1.${accountId}.`,
    `makeborne.creation-reference.v1.${accountId}.`,
    `makeborne.project-conversation.v1:${accountId}:`,
  ].some((prefix) => key.startsWith(prefix))) return true;
  if (key.startsWith("makeborne.wizard-draft.") && key.includes(`.account.${accountId}.`)) return true;
  if (!key.startsWith("makeborne.pending-write.")) return false;
  try {
    const saved: unknown = JSON.parse(storage.getItem(key) ?? "null");
    return typeof saved === "object" && saved !== null && (saved as { accountId?: unknown }).accountId === accountId;
  } catch { return false; }
}

/** Removes one account's drafts, recovery copies and request references from
 * browser storage after sign-out. Projects kept on this device without an
 * account, and other accounts' records, are left untouched. */
export function clearAccountLocalData(accountId: string | null | undefined, storages?: KeyedStorage[]) {
  if (!accountId) return;
  const targets = storages ?? [];
  if (!storages) {
    try { targets.push(localStorage); } catch { /* Storage is optional. */ }
    try { targets.push(sessionStorage); } catch { /* Storage is optional. */ }
  }
  for (const storage of targets) {
    try {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && ownedByAccount(storage, key, accountId)) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
    } catch { /* Sign-out still completes if browser storage is unavailable. */ }
  }
}
