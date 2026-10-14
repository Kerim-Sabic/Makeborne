import "server-only";
import {RequestError} from "../server/http";

/** A GitHub REST failure that keeps the upstream status for callers that need to
 * distinguish cases (for example an empty repository). The message stays generic. */
export class GitHubRequestError extends RequestError {
  constructor(code: string, message: string, status: number, public githubStatus: number) {
    super(code, message, status);
  }
}

export type GitHubFetch = (input: string, init: RequestInit) => Promise<Response>;
export type GitHubRequest = <T>(path: string, method?: string, body?: unknown, allow404?: boolean) => Promise<T | null>;

/** Bind a user token to api.github.com. `fetchImpl` is injectable so offline
 * checks can assert the exact request sequence without network access. */
export function githubClient(token: string, fetchImpl: GitHubFetch = fetch): GitHubRequest {
  return async function request<T>(path: string, method = "GET", body?: unknown, allow404 = false): Promise<T | null> {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid GitHub path");
    const response = await fetchImpl(`https://api.github.com${path}`, {method, headers: {Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "Content-Type": "application/json"}, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000)});
    if (allow404 && response.status === 404) return null;
    if (!response.ok) {
      const status = response.status;
      const limited = status === 429 || (status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")));
      if (status === 401) throw new GitHubRequestError("GITHUB_RECONNECT", "Your GitHub connection expired or was revoked. Reconnect GitHub to continue.", 401, status);
      if (limited) throw new GitHubRequestError("GITHUB_RATE_LIMITED", "GitHub is limiting requests right now. Wait a minute, then try again. Your saved website is unchanged.", 429, status);
      throw new GitHubRequestError("GITHUB_REQUEST_FAILED", status === 403 ? "Reconnect GitHub and check the selected repository permissions." : status === 409 || status === 422 ? "The repository changed. Refresh its status before syncing again." : "GitHub could not finish this request. Your saved website is unchanged.", 409, status);
    }
    return response.status === 204 ? null : await response.json() as T;
  };
}
