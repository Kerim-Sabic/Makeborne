import { z } from "zod";
import { OutreachSummarySchema, ClientProjectItemSchema } from "@/lib/cloud/contracts";
import {
  ArtifactSchema,
  ArtifactVersionSchema,
  ClientSchema,
  ProjectSchema,
} from "@/lib/domain";
let accountId: string | null = null;
let accountRevision = 0;
function pendingChanged() {
  window.dispatchEvent(new Event("makeborne-cloud-pending"));
}
export function setCloudAccount(id: string | null) {
  if (accountId !== id) accountRevision++;
  accountId = id;
}
export class CloudError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
    public uncertain = false,
  ) {
    super(message);
  }
}
const workspace = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  role: z.enum(["owner", "editor", "reviewer"]),
});
const client = ClientSchema.extend({ updatedAt: z.string().datetime(), outreachSummary: OutreachSummarySchema.optional() });
const project = ProjectSchema.extend({
  audience: z.string(),
  purpose: z.string(),
  wording: z.string(),
});
const page = z.object({
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
});
const mutation = z.object({
  idempotencyKey: z.string().uuid(),
  replayed: z.boolean(),
});
function schemaFor(path: string, method: string) {
  const base = path.split("?")[0];
  if (base === "/api/workspaces")
    return method === "GET"
      ? z.object({ workspaces: z.array(workspace) })
      : z.object({ workspace, mutation });
  if (/\/versions$/.test(base))
    return z.object({
      artifact: ArtifactSchema,
      version: ArtifactVersionSchema,
      mutation,
    });
  if (/\/artifacts\/[a-f0-9-]+$/.test(base))
    return z.object({
      artifact: ArtifactSchema,
      versions: z.array(ArtifactVersionSchema),
      pagination: page,
    });
  if (/\/projects\/[a-f0-9-]+\/artifacts$/.test(base))
    return z.object({ artifact: ArtifactSchema, mutation });
  if (/\/clients\/[a-f0-9-]+$/.test(base)) return z.object({ client });
  if (/\/studio-projects$/.test(base)) return z.object({ project, artifact: ArtifactSchema, version: ArtifactVersionSchema, mutation });
  if (/\/clients$/.test(base)) return method === "GET" ? z.object({
    clients: z.array(client).max(50),
    pagination: page.omit({ offset: true }),
    counts: z.object({ all: z.number().int().nonnegative(), overdue: z.number().int().nonnegative(), today: z.number().int().nonnegative(), upcoming: z.number().int().nonnegative(), unscheduled: z.number().int().nonnegative() }),
  }) : z.object({ client, mutation });
  if (/\/clients\/[a-f0-9-]+\/projects$/.test(base) && method === "GET") return z.object({ items: z.array(ClientProjectItemSchema).max(50), pagination: page.omit({ offset: true }) });
  if (/\/projects$/.test(base)) return z.object({ project, mutation });
  if (/\/workspaces\/[a-f0-9-]+$/.test(base))
    return z.object({
      workspace,
      clients: z.array(client),
      projects: z.array(project),
      artifacts: z.array(ArtifactSchema),
      pagination: z.object({ clients: page, projects: page, artifacts: page }),
    });
  throw new CloudError(400, "This cloud operation is unsupported.");
}
const activeRequests = new Set<string>();
export async function api<T>(
  path: string,
  body?: unknown,
  method = "POST",
  options?: { idempotencyKey: string },
): Promise<T> {
  const verb = body ? method : method === "POST" ? "GET" : method;
  const bodyText = body ? JSON.stringify(body) : undefined;
  const signature = `${verb}:${path}:${bodyText || ""}`;
  const requestAccount = accountId;
  const requestRevision = accountRevision;
  const activeSignature = `${requestAccount}:${signature}`;
  const isWrite = verb !== "GET";
  function assertAccount(uncertain = false) {
    if (requestRevision !== accountRevision) throw new CloudError(409,
      uncertain ? "Your account changed while this save was in progress. Sign back into the original account and review the saved record before retrying." : "Your account changed. Reopen this view before continuing.",
      "ACCOUNT_CHANGED", uncertain);
  }
  if (isWrite && !requestAccount) throw new CloudError(401, "Verify your account before saving cloud work.", "ACCOUNT_REQUIRED");
  if (isWrite && activeRequests.has(activeSignature))
    throw new CloudError(
      409,
      "This request is already in progress. Wait for its result.",
      "REQUEST_PENDING",
    );
  if (isWrite) activeRequests.add(activeSignature);
  let storageId: string | undefined;
  let requestKey: string | undefined;
  try {
    const schema = schemaFor(path, verb);
    const headers: Record<string, string> = {};
    if (requestAccount) headers["X-Makeborne-Account"] = requestAccount;
    if (bodyText) headers["Content-Type"] = "application/json";
    const needsKey =
      verb === "POST" &&
      (path.startsWith("/api/cloud/") || path === "/api/workspaces");
    if (options && !needsKey) throw new CloudError(400, "This operation does not accept a creation request key.", "UNSUPPORTED_REQUEST_KEY");
    if (needsKey) {
      const suppliedKey = options ? z.string().uuid().parse(options.idempotencyKey) : undefined;
      if (!requestAccount)
        throw new CloudError(
          401,
          "Verify your account before saving cloud work.",
        );
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`${requestAccount}:${signature}`),
      );
      assertAccount();
      storageId = `makeborne.pending-write.${Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")}`;
      try {
        const existing = localStorage.getItem(storageId);
        if (existing) {
          const pending = z
            .object({
              key: z.string().uuid(),
              body: z.string(),
              path: z.string(),
              method: z.string(),
              accountId: z.string().uuid(),
            })
            .parse(JSON.parse(existing));
          if (
            pending.accountId !== requestAccount ||
            pending.path !== path ||
            pending.method !== verb ||
            pending.body !== bodyText ||
            (suppliedKey !== undefined && pending.key !== suppliedKey)
          )
            throw new Error("Pending request does not match");
          requestKey = pending.key;
        } else {
          requestKey = suppliedKey ?? crypto.randomUUID();
          localStorage.setItem(
            storageId,
            JSON.stringify({
              key: requestKey,
              body: bodyText,
              path,
              method: verb,
              accountId: requestAccount,
              createdAt: new Date().toISOString(),
            }),
          );
          pendingChanged();
        }
      } catch {
        throw new CloudError(
          503,
          "This device could not preserve the pending write. No request was sent; download your draft and free browser storage before saving.",
          "PENDING_STORAGE_UNAVAILABLE",
        );
      }
      headers["Idempotency-Key"] = requestKey;
    }
    assertAccount();
    let response: Response;
    try {
      response = await fetch(path, {
        method: verb,
        headers,
        body: bodyText,
        cache: "no-store",
      });
    } catch {
      throw new CloudError(
        503,
        body
          ? "The cloud could not confirm this write. Keep your draft and retry the same operation after reviewing saved records."
          : "The cloud could not be reached.",
        "NETWORK_UNCONFIRMED",
        !!body,
      );
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new CloudError(
        503,
        "The cloud returned an unreadable result. Keep your draft and review saved records before retrying.",
        "RESPONSE_UNCONFIRMED",
        !!body,
      );
    }
    assertAccount(isWrite);
    if (!response.ok) {
      const error = z
        .object({
          error: z.object({ message: z.string(), code: z.string().optional() }),
        })
        .safeParse(data);
      const uncertain = !!body && response.status >= 500;
      // Keep request identities even after access errors: an earlier uncertain attempt may already exist.
      throw new CloudError(
        response.status,
        error.success
          ? error.data.error.message
          : "The cloud request could not complete.",
        error.success ? error.data.error.code : "REQUEST_FAILED",
        uncertain,
      );
    }
    const result = schema.safeParse(data);
    if (!result.success)
      throw new CloudError(
        503,
        "The cloud response could not be verified. Your draft is preserved; review saved records before another write.",
        "RESPONSE_UNCONFIRMED",
        !!body,
      );
    if (
      requestKey &&
      "mutation" in result.data &&
      (result.data as { mutation: { idempotencyKey: string } }).mutation
        .idempotencyKey !== requestKey
    )
      throw new CloudError(
        503,
        "The cloud did not confirm the expected request identity. Keep your draft and review the saved record.",
        "RESPONSE_UNCONFIRMED",
        true,
      );
    if (storageId) {
      try {
        localStorage.removeItem(storageId);
        pendingChanged();
      } catch { /* A cleanup failure must not turn a confirmed save into a failed write. */ }
    }
    return result.data as T;
  } finally {
    if (isWrite) activeRequests.delete(activeSignature);
  }
}
export type PendingCloudWrite = {
  storageId: string;
  key: string;
  body: string;
  path: string;
  method: string;
  accountId: string;
  createdAt?: string;
};
export function getPendingCloudWrites(userId: string): PendingCloudWrite[] {
  const items: PendingCloudWrite[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const id = localStorage.key(i);
      if (!id?.startsWith("makeborne.pending-write.")) continue;
      const saved = localStorage.getItem(id);
      if (!saved) continue;
      const parsed = z
        .object({
          key: z.string().uuid(),
          body: z.string().max(2500000),
          path: z
            .string()
            .regex(
              /^\/api\/workspaces$|^\/api\/cloud\/workspaces\/[a-f0-9-]+\/(clients|projects|studio-projects|projects\/[a-f0-9-]+\/artifacts|artifacts\/[a-f0-9-]+\/versions)$/,
            ),
          method: z.literal("POST"),
          accountId: z.string().uuid(),
          createdAt: z.string().optional(),
        })
        .safeParse(JSON.parse(saved));
      if (parsed.success && parsed.data.accountId === userId)
        items.push({ ...parsed.data, storageId: id });
    }
  } catch {
    /* Unreadable records are preserved rather than replaced. */
  }
  return items;
}

/** Binary reads retain the same account-switch fence as JSON account reads. */
export async function readCloudImage(path: string, expectedAccount: string, signal: AbortSignal): Promise<Blob> {
  const revision = accountRevision;
  if (!expectedAccount || accountId !== expectedAccount) throw new Error("Your account changed. Reopen this project.");
  const response = await fetch(path, { headers: { "X-Makeborne-Account": expectedAccount }, cache: "no-store", signal });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error?.message || "Artwork is unavailable. Check access or try again.");
  }
  if (response.headers.get("content-type")?.split(";")[0] !== "image/webp") throw new Error("Invalid artwork response.");
  const blob = await response.blob();
  if (signal.aborted || accountId !== expectedAccount || revision !== accountRevision) throw new Error("Your account changed. Reopen this project.");
  if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error("Artwork preview exceeds the supported size.");
  return blob;
}

export async function uploadCloudImage(path: string, file: File, expectedAccount: string, signal: AbortSignal): Promise<string> {
  const revision = accountRevision;
  if (!expectedAccount || accountId !== expectedAccount) throw new Error("Your account changed. Reopen this project.");
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error("Choose an image under 8 MB.");
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Makeborne-Account": expectedAccount }, body: file, cache: "no-store", signal });
  const result = await response.json();
  if (signal.aborted || revision !== accountRevision || accountId !== expectedAccount) throw new Error("Your account changed. The image was not added to this editor.");
  if (!response.ok) throw new Error(result?.error?.message || "Upload could not be confirmed. Retry the same file.");
  return z.object({ asset: z.object({ id: z.string().uuid() }), reused: z.boolean() }).parse(result).asset.id;
}

/** Capture once for multi-stage downloads, including account A -> B -> A changes. */
export function cloudAccountGuard(expectedAccount: string) {
  const revision = accountRevision;
  const assertCurrent = () => {
    if (!expectedAccount || accountId !== expectedAccount || accountRevision !== revision) throw new Error("Your account changed. Reopen this project.");
  };
  assertCurrent();
  return assertCurrent;
}
