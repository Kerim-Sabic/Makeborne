/**
 * What "Disconnect GitHub" does, in the customer's words. The route (api/github/connection
 * DELETE) only deletes Makeborne's stored tokens for this person; the GitHub App's user
 * authorization and its repository installation stay at GitHub until revoked there. Client-safe.
 */
export const GITHUB_AUTHORIZATIONS_URL = "https://github.com/settings/apps/authorizations";
export const GITHUB_INSTALLATIONS_URL = "https://github.com/settings/installations";

export const GITHUB_DISCONNECT_CONFIRM = "Disconnect GitHub from your Makeborne account? Makeborne deletes its stored GitHub access, so none of your projects can push until you connect again. Your repositories and exported code stay in GitHub, and the Makeborne GitHub app stays authorized there until you revoke it in your GitHub settings.";
export const GITHUB_DISCONNECTED = "Disconnected. Makeborne deleted its stored GitHub access; your repositories and exported code stay in GitHub. The Makeborne GitHub app stays authorized in GitHub until you revoke it there.";
