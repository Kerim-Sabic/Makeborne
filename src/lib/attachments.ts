/** Device-only source files. The live builder explicitly sends selected sources to AI. */
export const ATTACHMENT_LIMITS = { count: 10, fileBytes: 25 * 1024 * 1024, totalBytes: 100 * 1024 * 1024 };
export type Attachment = { id: string; name: string; type: string; size: number; owner: string; blob: Blob; previewType: string | null };
/** On disk a file is its Blob, or — where the engine refuses Blob values in IndexedDB — its bytes. */
type StoredAttachment = Omit<Attachment, "blob"> & { blob?: Blob; bytes?: ArrayBuffer };
type Collection = { key: string; owner: string; ids: string[]; builderRequest?: { context: string; actionKey: string; operationId?: string; createdAt: number; expiresAt: number } };
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
const BLOB_PROBE_ID = "makeborne:blob-probe";
let blobValues: Promise<boolean> | null = null;
/** WebKit refuses Blob and File values in IndexedDB in ephemeral sessions (Safari private browsing,
 * automation contexts): the whole transaction aborts. Probe once per page; where Blobs are refused the
 * same files are kept as their bytes instead, so attaching works rather than failing as "out of storage". */
function storesBlobValues(): Promise<boolean> {
  blobValues ??= openDatabase().then(db => new Promise<boolean>(resolve => {
    let stored = false;
    const finish = (value: boolean) => { db.close(); resolve(value); };
    const tx = db.transaction("files", "readwrite");
    tx.oncomplete = () => finish(stored);
    tx.onabort = () => finish(false);
    try {
      const put = tx.objectStore("files").put({ id: BLOB_PROBE_ID, blob: new Blob(["probe"], { type: "text/plain" }) });
      put.onsuccess = () => { stored = true; tx.objectStore("files").delete(BLOB_PROBE_ID); };
      put.onerror = event => { event.preventDefault(); };
    } catch { /* DataCloneError: the transaction still completes without the probe. */ }
  }), () => false);
  return blobValues;
}
/** Encode before a transaction opens: reading bytes is asynchronous and would end an open transaction. */
async function storable(files: readonly (Attachment | StoredAttachment)[]): Promise<StoredAttachment[]> {
  if (await storesBlobValues()) return [...files];
  return Promise.all(files.map(async ({ blob, ...file }) => blob ? { ...file, bytes: await blob.arrayBuffer() } : file));
}
function readable({ bytes, ...file }: StoredAttachment): Attachment {
  if (bytes) return { ...file, blob: new Blob([bytes], { type: file.type }) };
  if (!file.blob) throw new Error("Some attached files are unavailable on this device.");
  return file as Attachment;
}
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
async function collectionRecords(tx: IDBTransaction, owner: string, context: string) {
  const collection = await requestValue<Collection | undefined>(tx.objectStore("collections").get(collectionKey(owner, context)));
  if (!collection) return [];
  if (collection.owner !== owner) throw new Error("These files belong to another account.");
  const files = await Promise.all(collection.ids.map(id => requestValue<StoredAttachment | undefined>(tx.objectStore("files").get(id))));
  if (files.some(file => !file || file.owner !== owner)) throw new Error("Some attached files are unavailable on this device.");
  return files as StoredAttachment[];
}
async function collectionFiles(tx: IDBTransaction, owner: string, context: string) {
  return (await collectionRecords(tx, owner, context)).map(readable);
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
  const stored = await storable(records);
  return transaction("readwrite", async tx => {
    const previous = await collectionFiles(tx, owner, context);
    const next = [...previous, ...records];
    if (next.length > ATTACHMENT_LIMITS.count) throw new Error("You can attach up to 10 files. Remove a file before adding more.");
    if (next.reduce((sum, file) => sum + file.size, 0) > ATTACHMENT_LIMITS.totalBytes) throw new Error("Keep the combined attachments under 100 MB.");
    stored.forEach(file => tx.objectStore("files").put(file));
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
      const files = await collectionRecords(tx, "device", `draft:${requestId}`);
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

export const BUILDER_SNAPSHOT_RETENTION = { count: 8, lifetimeMs: 24 * 60 * 60 * 1000 };
const requestContext = (context: string, actionKey: string) => `builder-request:${context}:${actionKey}`;
const missingSources = () => new Error("The original request's source files are unavailable or expired on this device. Start a new request with your sources attached; continuing cannot replace the original files.");

async function pruneBuilderSnapshots(tx: IDBTransaction, owner: string, now: number, clearContext?: string | true) {
  const store = tx.objectStore("collections");
  const collections = await requestValue<Collection[]>(store.getAll());
  const snapshots = collections.filter(item => item.owner === owner && item.builderRequest)
    .sort((a, b) => b.builderRequest!.createdAt - a.builderRequest!.createdAt);
  const deleted = new Set(snapshots.filter((item, index) => index >= BUILDER_SNAPSHOT_RETENTION.count || item.builderRequest!.expiresAt <= now
    || clearContext === true || item.builderRequest!.context === clearContext).map(item => item.key));
  deleted.forEach(key => store.delete(key));
  const referenced = new Set(collections.filter(item => !deleted.has(item.key)).flatMap(item => item.ids));
  // Only inspect IDs from evicted snapshots, preserving ordinary project storage.
  snapshots.filter(item => deleted.has(item.key)).forEach(item => item.ids.forEach(id => { if (!referenced.has(id)) tx.objectStore("files").delete(id); }));
}

/** Retain exact source references before sending. Removing a project selection
 * cannot mutate an authorized request; the bounded snapshot owns those blobs. */
export async function retainBuilderAttachmentSnapshot(owner: string, context: string, actionKey: string, files: readonly Attachment[]) {
  if (files.some(file => file.owner !== owner)) throw new Error("These sources belong to another account.");
  const stored = await storable(files);
  return transaction("readwrite", async tx => {
    const key = collectionKey(owner, requestContext(context, actionKey));
    const store = tx.objectStore("collections");
    const existing = await requestValue<Collection | undefined>(store.get(key));
    const ids = files.map(file => file.id);
    if (existing && JSON.stringify(existing.ids) !== JSON.stringify(ids)) throw new Error("This request already has different source files. Start a new request.");
    if (!existing) {
      const now = Date.now();
      const collections = await requestValue<Collection[]>(store.getAll());
      const createdAt = Math.max(now, ...collections.filter(item => item.owner === owner && item.builderRequest).map(item => item.builderRequest!.createdAt + 1));
      // Write only copies that are missing. Firefox ties a Blob read from IndexedDB to its stored record:
      // rewriting a record that already exists makes every Blob already read from it unreadable
      // ("The operation was aborted"), which would break the files the composer is about to send again.
      for (const file of stored) {
        const current = await requestValue<StoredAttachment | undefined>(tx.objectStore("files").get(file.id));
        if (current && current.owner !== owner) throw new Error("These sources belong to another account.");
        if (!current) tx.objectStore("files").put(file);
      }
      store.put({ key, owner, ids, builderRequest: { context, actionKey, createdAt, expiresAt: now + BUILDER_SNAPSHOT_RETENTION.lifetimeMs } } satisfies Collection);
    }
    await pruneBuilderSnapshots(tx, owner, Date.now());
  });
}

/** Binding follows a server-observed operation identity; it never changes bytes. */
export function bindBuilderAttachmentSnapshot(owner: string, context: string, actionKey: string, operationId: string) {
  return transaction("readwrite", async tx => {
    await pruneBuilderSnapshots(tx, owner, Date.now());
    const key = collectionKey(owner, requestContext(context, actionKey));
    const store = tx.objectStore("collections");
    const snapshot = await requestValue<Collection | undefined>(store.get(key));
    if (!snapshot?.builderRequest || snapshot.owner !== owner || snapshot.builderRequest.context !== context) return;
    if (snapshot.builderRequest.operationId && snapshot.builderRequest.operationId !== operationId) throw new Error("The original source request does not match this operation.");
    store.put({ ...snapshot, builderRequest: { ...snapshot.builderRequest, operationId } } satisfies Collection);
  });
}

export function readBuilderAttachmentSnapshot(owner: string, context: string, operationId: string) {
  return transaction("readwrite", async tx => {
    await pruneBuilderSnapshots(tx, owner, Date.now());
    const collections = await requestValue<Collection[]>(tx.objectStore("collections").getAll());
    const snapshot = collections.find(item => item.owner === owner && item.builderRequest?.context === context && item.builderRequest.operationId === operationId);
    if (!snapshot?.builderRequest) return null;
    return collectionFiles(tx, owner, requestContext(context, snapshot.builderRequest.actionKey));
  }).then(files => { if (!files) throw missingSources(); return files; });
}

/** Call after deleting a project (context) or the account (omit context). */
export function clearBuilderAttachmentSnapshots(owner: string, context?: string) {
  return transaction("readwrite", tx => pruneBuilderSnapshots(tx, owner, Date.now(), context ?? true));
}
