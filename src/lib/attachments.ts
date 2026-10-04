/** Device-only source files. Blob bytes never enter web storage or a cloud request. */
export const ATTACHMENT_LIMITS = { count: 10, fileBytes: 25 * 1024 * 1024, totalBytes: 100 * 1024 * 1024 };
export type Attachment = { id: string; name: string; type: string; size: number; owner: string; blob: Blob; previewType: string | null };
type Collection = { key: string; owner: string; ids: string[] };
type PendingCreation = { requestId: string; nonce: string; owner: string; draft: Record<string, unknown> };
export const attachmentOwner = (accountId: string | null) => accountId ? `account:${accountId}` : "device";
export const projectAttachmentKey = (projectKey: string) => `project:${projectKey}`;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("makeborne.attachments.v1", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files", { keyPath: "id" });
      if (!request.result.objectStoreNames.contains("collections")) request.result.createObjectStore("collections", { keyPath: "key" });
      if (!request.result.objectStoreNames.contains("drafts")) request.result.createObjectStore("drafts", { keyPath: "requestId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("This browser could not open file storage. Try allowing site storage."));
    request.onblocked = () => reject(new Error("Close other Makeborne tabs and try attaching the files again."));
  });
}
const collectionKey = (owner: string, context: string) => `${owner}/${context}`;
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function completion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(new Error("These files could not be saved. Your browser may be out of storage."));
  });
}
async function transaction<T>(mode: IDBTransactionMode, run: (tx: IDBTransaction) => Promise<T>) {
  const db = await openDatabase();
  const tx = db.transaction(["files", "collections", "drafts"], mode);
  const done = completion(tx);
  try { const result = await run(tx); await done; return result; }
  catch (error) { try { tx.abort(); } catch { /* Already settled. */ } await done.catch(() => {}); throw error; }
  finally { db.close(); }
}
async function collectionFiles(tx: IDBTransaction, owner: string, context: string) {
  const collection = await requestValue<Collection | undefined>(tx.objectStore("collections").get(collectionKey(owner, context)));
  if (!collection) return [];
  if (collection.owner !== owner) throw new Error("These files belong to another account.");
  const files = await Promise.all(collection.ids.map(id => requestValue<Attachment | undefined>(tx.objectStore("files").get(id))));
  if (files.some(file => !file || file.owner !== owner)) throw new Error("Some attached files are unavailable on this device.");
  return files as Attachment[];
}
export function readAttachments(owner: string, context: string) {
  return transaction("readonly", tx => collectionFiles(tx, owner, context));
}
export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
/** Sniff raster signatures; SVG/HTML/PDF and mislabeled documents are download-only. */
async function rasterType(file: File) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 && b[4] === 13 && b[5] === 10 && b[6] === 26 && b[7] === 10) return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  if (["GIF87a", "GIF89a"].includes(String.fromCharCode(...b.slice(0, 6)))) return "image/gif";
  return null;
}
export async function addAttachments(owner: string, context: string, files: File[]) {
  if (!files.length) return readAttachments(owner, context);
  if (files.length > ATTACHMENT_LIMITS.count) throw new Error("Attach up to 10 files at a time.");
  const tooLarge = files.find(file => file.size > ATTACHMENT_LIMITS.fileBytes);
  if (tooLarge) throw new Error(`${tooLarge.name} is too large. Each file can be up to 25 MB.`);
  const records: Attachment[] = await Promise.all(files.map(async file => ({ id: crypto.randomUUID(), name: file.name.slice(0, 255), type: file.type || "application/octet-stream", size: file.size, owner, blob: file, previewType: await rasterType(file) })));
  return transaction("readwrite", async tx => {
    const previous = await collectionFiles(tx, owner, context);
    const next = [...previous, ...records];
    if (next.length > ATTACHMENT_LIMITS.count) throw new Error("You can attach up to 10 files. Remove a file before adding more.");
    if (next.reduce((sum, file) => sum + file.size, 0) > ATTACHMENT_LIMITS.totalBytes) throw new Error("Keep the combined attachments under 100 MB.");
    records.forEach(file => tx.objectStore("files").put(file));
    tx.objectStore("collections").put({ key: collectionKey(owner, context), owner, ids: next.map(file => file.id) } satisfies Collection);
    return next;
  });
}
export function removeAttachment(owner: string, context: string, id: string) {
  return transaction("readwrite", async tx => {
    const files = await collectionFiles(tx, owner, context);
    const next = files.filter(file => file.id !== id);
    const key = collectionKey(owner, context);
    tx.objectStore("collections").put({ key, owner, ids: next.map(file => file.id) } satisfies Collection);
    const collections = await requestValue<Collection[]>(tx.objectStore("collections").getAll());
    if (!collections.some(item => item.key !== key && item.ids.includes(id))) tx.objectStore("files").delete(id);
    return next;
  });
}
/** Copy references atomically. Retaining the draft makes a failed project handoff retryable. */
export function copyAttachments(owner: string, from: string, to: string) {
  return transaction("readwrite", async tx => {
    const files = await collectionFiles(tx, owner, from);
    const existing = await collectionFiles(tx, owner, to);
    const ids = [...new Set([...existing.map(file => file.id), ...files.map(file => file.id)])];
    tx.objectStore("collections").put({ key: collectionKey(owner, to), owner, ids } satisfies Collection);
  });
}
/** Only an explicit submitted prompt creates an authentication handoff intent. */
export function saveCreationDraft(owner: string, requestId: string, nonce: string, draft: Record<string, unknown>) {
  return transaction("readwrite", async tx => {
    const files = await collectionFiles(tx, owner, "home");
    tx.objectStore("collections").put({ key: collectionKey(owner, `draft:${requestId}`), owner, ids: files.map(file => file.id) } satisfies Collection);
    tx.objectStore("drafts").put({ requestId, nonce, owner, draft: { ...draft, attachmentOwner: owner } } satisfies PendingCreation);
  });
}
/** An anonymous intent binds once to the account that completes its login flow.
 * Repeating the same return URL is safe only for that bound account. */
export function claimCreationDraft(requestId: string, nonce: string, accountId: string) {
  const targetOwner = attachmentOwner(accountId);
  return transaction("readwrite", async tx => {
    const record = await requestValue<PendingCreation | undefined>(tx.objectStore("drafts").get(requestId));
    if (!record || record.nonce !== nonce) throw new Error("This draft is saved in the browser where you started it. Continue in that browser, or start a new project here.");
    if (record.owner !== "device" && record.owner !== targetOwner) throw new Error("This draft belongs to another account. Sign back into the account that started it.");
    if (record.owner === "device") {
      const files = await collectionFiles(tx, "device", `draft:${requestId}`);
      const copies = files.map(file => ({ ...file, id: crypto.randomUUID(), owner: targetOwner }));
      copies.forEach(file => tx.objectStore("files").put(file));
      tx.objectStore("collections").put({ key: collectionKey(targetOwner, `draft:${requestId}`), owner: targetOwner, ids: copies.map(file => file.id) } satisfies Collection);
      const transferred = new Set(files.map(file => file.id));
      const home = await collectionFiles(tx, "device", "home");
      tx.objectStore("collections").put({ key: collectionKey("device", "home"), owner: "device", ids: home.filter(file => !transferred.has(file.id)).map(file => file.id) } satisfies Collection);
      tx.objectStore("collections").delete(collectionKey("device", `draft:${requestId}`));
      const collections = await requestValue<Collection[]>(tx.objectStore("collections").getAll());
      files.forEach(file => { if (!collections.some(collection => collection.ids.includes(file.id))) tx.objectStore("files").delete(file.id); });
    }
    const draft = { ...record.draft, attachmentOwner: targetOwner };
    tx.objectStore("drafts").put({ ...record, owner: targetOwner, draft } satisfies PendingCreation);
    return draft;
  });
}
export function finishAttachmentHandoff(owner: string, requestId: string) {
  return transaction("readwrite", async tx => {
    const draft = await collectionFiles(tx, owner, `draft:${requestId}`);
    const home = await collectionFiles(tx, owner, "home");
    const transferred = new Set(draft.map(file => file.id));
    tx.objectStore("collections").put({ key: collectionKey(owner, "home"), owner, ids: home.filter(file => !transferred.has(file.id)).map(file => file.id) } satisfies Collection);
    tx.objectStore("collections").delete(collectionKey(owner, `draft:${requestId}`));
    tx.objectStore("drafts").delete(requestId);
  });
}
