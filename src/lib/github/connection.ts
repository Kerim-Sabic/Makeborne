import "server-only";
import { z } from "zod";
import { RequestError } from "../server/http";
import type { GitHubFetch } from "./api";

/* GitHub App user-to-server tokens last eight hours; the refresh token GitHub
 * issues alongside lasts about six months and is single-use. This module keeps
 * the stored connection usable by renewing it, without ever logging, returning
 * or putting tokens in error messages. Every dependency is injected so offline
 * checks can drive it with a mocked GitHub and an in-memory database. */

export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const ACCESS_LIFETIME_CAP = 28_800; // seconds; GitHub issues eight-hour user tokens.
const REFRESH_LIFETIME_CAP = 15_897_600; // seconds; GitHub's documented six-month refresh lifetime.
const RENEW_MARGIN_MS = 60_000;
/** GitHub reports a refresh token that can never be used again with one of these. */
const REVOKED_GRANT_ERRORS = new Set(["bad_refresh_token", "invalid_grant", "expired_token", "unauthorized_client"]);
const COLUMNS = "user_id,github_user_id,login,token_ciphertext,expires_at,refresh_ciphertext,refresh_expires_at";

export function reconnectError() {
  return new RequestError("GITHUB_RECONNECT", "Your GitHub connection has ended. Reconnect GitHub to keep syncing.", 401);
}
function renewalUnavailable() {
  return new RequestError("GITHUB_RENEWAL_FAILED", "GitHub could not renew your connection right now. Try again in a minute. Your saved website is unchanged.", 503);
}

const TokenGrantSchema = z.object({
  access_token: z.string().min(20).max(4096),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(20).max(4096).optional(),
  refresh_token_expires_in: z.number().positive().optional(),
});
const TokenErrorSchema = z.object({ error: z.string().max(200) });
export type GitHubTokenGrant = z.infer<typeof TokenGrantSchema>;

/** Validate a GitHub token endpoint body. Throws without echoing the body. */
export function parseTokenGrant(body: unknown): GitHubTokenGrant {
  const parsed = TokenGrantSchema.safeParse(body);
  if (!parsed.success) throw new Error("Invalid GitHub token response");
  return parsed.data;
}

export type TokenColumns = { token_ciphertext: string; expires_at: string; refresh_ciphertext: string | null; refresh_expires_at: string | null };

/** The stored token columns for a grant. A grant without a refresh token (an
 * App with expiring tokens disabled) stores null and needs reconnecting later. */
export function tokenColumns(grant: GitHubTokenGrant, seal: (token: string) => string, now = Date.now()): TokenColumns {
  const refresh = grant.refresh_token && grant.refresh_token_expires_in ? grant.refresh_token : null;
  return {
    token_ciphertext: seal(grant.access_token),
    expires_at: new Date(now + Math.min(grant.expires_in, ACCESS_LIFETIME_CAP) * 1000).toISOString(),
    refresh_ciphertext: refresh ? seal(refresh) : null,
    refresh_expires_at: refresh ? new Date(now + Math.min(grant.refresh_token_expires_in!, REFRESH_LIFETIME_CAP) * 1000).toISOString() : null,
  };
}

export type ConnectionRow = {
  user_id: string; github_user_id: number; login: string; token_ciphertext: string; expires_at: string;
  refresh_ciphertext?: string | null; refresh_expires_at?: string | null;
};
type DbResult<T> = PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>;
/** The subset of the Supabase service client this module uses. */
export type ConnectionDatabase = {
  from(table: "github_connections"): {
    select(columns: string): { eq(column: string, value: unknown): { maybeSingle(): DbResult<ConnectionRow> } };
    update(values: Record<string, unknown>): { eq(column: string, value: unknown): { eq(column: string, value: unknown): { select(columns: string): DbResult<{ user_id: string }[]> } } };
  };
};

export type ActiveGitHubToken = { token: string; githubUserId: number; login: string };
export type GitHubConnectionDeps = {
  db: ConnectionDatabase;
  config: { clientId: string; secret: string };
  seal(token: string): string;
  open(ciphertext: string): string;
  fetch?: GitHubFetch;
  dbError?(error: { code?: string } | null): void;
  now?(): number;
  sleep?(ms: number): Promise<void>;
  /** In-process single flight per user; the database compare-and-swap covers other instances. */
  renewals?: Map<string, Promise<ActiveGitHubToken>>;
  /** Re-reads while waiting for a concurrent winner to store its tokens. */
  settleAttempts?: number;
  settleDelayMs?: number;
};

const fresh = (row: ConnectionRow, now: number) => Date.parse(row.expires_at) >= now + RENEW_MARGIN_MS;
const refreshUsable = (row: ConnectionRow, now: number) => !!row.refresh_ciphertext && !!row.refresh_expires_at && Date.parse(row.refresh_expires_at) > now + RENEW_MARGIN_MS;

/** A usable access token for the stored connection, renewing it when it expires
 * within a minute. Throws GITHUB_RECONNECT when only a new sign-in can help. */
export async function activeGitHubToken(userId: string, deps: GitHubConnectionDeps): Promise<ActiveGitHubToken> {
  const renewals = deps.renewals;
  const pending = renewals?.get(userId);
  if (pending) return pending;
  const work = resolveToken(userId, deps);
  if (!renewals) return work;
  renewals.set(userId, work);
  try { return await work; } finally { if (renewals.get(userId) === work) renewals.delete(userId); }
}

async function resolveToken(userId: string, deps: GitHubConnectionDeps): Promise<ActiveGitHubToken> {
  const now = deps.now ?? Date.now;
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await readConnection(userId, deps);
    if (!row) throw reconnectError();
    if (fresh(row, now())) return active(row, deps);
    if (!row.refresh_ciphertext) throw reconnectError();
    if (!refreshUsable(row, now())) { await clearRefresh(userId, row.refresh_ciphertext, deps); throw reconnectError(); }
    const outcome = await renew(userId, row, deps);
    if (outcome.kind === "renewed") return outcome.token;
    if (outcome.kind === "revoked") {
      // A concurrent renewal may have spent this refresh token first; wait for its result.
      const latest = await settle(userId, row.refresh_ciphertext, deps);
      if (latest !== "unchanged") continue;
      if (await clearRefresh(userId, row.refresh_ciphertext, deps)) throw reconnectError();
    }
    // Lost the compare-and-swap or the row changed: re-read and use the winner's tokens.
  }
  throw reconnectError();
}

async function readConnection(userId: string, deps: GitHubConnectionDeps) {
  // Explicit columns: the refresh columns must exist, so the migration precedes this code.
  const { data, error } = await deps.db.from("github_connections").select(COLUMNS).eq("user_id", userId).maybeSingle();
  failOn(error, deps);
  return data;
}

function active(row: ConnectionRow, deps: GitHubConnectionDeps): ActiveGitHubToken {
  let token: string;
  try { token = deps.open(row.token_ciphertext); } catch { throw reconnectError(); }
  return { token, githubUserId: Number(row.github_user_id), login: row.login };
}

type RenewOutcome = { kind: "renewed"; token: ActiveGitHubToken } | { kind: "revoked" } | { kind: "lost" };

async function renew(userId: string, row: ConnectionRow, deps: GitHubConnectionDeps): Promise<RenewOutcome> {
  let refreshToken: string;
  try { refreshToken = deps.open(row.refresh_ciphertext!); } catch { return { kind: "revoked" }; }
  let body: unknown;
  try {
    const response = await (deps.fetch ?? fetch)(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: deps.config.clientId, client_secret: deps.config.secret, grant_type: "refresh_token", refresh_token: refreshToken }),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    body = await response.json().catch(() => null);
    const failure = TokenErrorSchema.safeParse(body);
    if (failure.success) {
      if (REVOKED_GRANT_ERRORS.has(failure.data.error)) return { kind: "revoked" };
      throw renewalUnavailable();
    }
    if (!response.ok) throw renewalUnavailable();
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw renewalUnavailable(); // Network failure or timeout: keep the stored refresh token.
  }
  const parsed = TokenGrantSchema.safeParse(body);
  if (!parsed.success) throw renewalUnavailable();
  const grant = parsed.data;
  const columns = tokenColumns(grant, deps.seal, (deps.now ?? Date.now)());
  // Compare-and-swap on the spent refresh ciphertext (random IV, so unique per seal):
  // exactly one concurrent renewal can store its tokens.
  const { data, error } = await deps.db.from("github_connections")
    .update({ ...columns, updated_at: new Date((deps.now ?? Date.now)()).toISOString() })
    .eq("user_id", userId).eq("refresh_ciphertext", row.refresh_ciphertext)
    .select("user_id");
  failOn(error, deps);
  if (!data?.length) return { kind: "lost" };
  return { kind: "renewed", token: { token: grant.access_token, githubUserId: Number(row.github_user_id), login: row.login } };
}

/** Re-read until the refresh ciphertext moves on from `spent`, or give up. */
async function settle(userId: string, spent: string, deps: GitHubConnectionDeps): Promise<"changed" | "unchanged"> {
  const attempts = deps.settleAttempts ?? 5, delay = deps.settleDelayMs ?? 200;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  for (let i = 0; i < attempts; i++) {
    const row = await readConnection(userId, deps);
    if (!row || row.refresh_ciphertext !== spent) return "changed";
    if (i < attempts - 1) await sleep(delay);
  }
  return "unchanged";
}

/** Clear refresh columns only if they still hold `spent`. True when cleared. */
async function clearRefresh(userId: string, spent: string, deps: GitHubConnectionDeps) {
  const { data, error } = await deps.db.from("github_connections")
    .update({ refresh_ciphertext: null, refresh_expires_at: null, updated_at: new Date((deps.now ?? Date.now)()).toISOString() })
    .eq("user_id", userId).eq("refresh_ciphertext", spent)
    .select("user_id");
  failOn(error, deps);
  return !!data?.length;
}

function failOn(error: { code?: string } | null, deps: GitHubConnectionDeps) {
  if (!error) return;
  deps.dbError?.(error);
  throw new RequestError("GITHUB_CONNECTION_UNAVAILABLE", "Your GitHub connection could not be loaded. Try again in a minute.", 503);
}
