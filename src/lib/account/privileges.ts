import "server-only";
import { accountsEnabled } from "@/lib/supabase/auth-server";
import { createClient } from "@/lib/supabase/server";

export type AccountPrivileges = { isAdmin: boolean; unlimitedCredits: boolean };
const noPrivileges: AccountPrivileges = { isAdmin: false, unlimitedCredits: false };

/** Read current, operator-owned grants; never trust email matches or JWT metadata. */
export async function getAccountPrivileges(expectedUserId?: string): Promise<AccountPrivileges> {
  if (!accountsEnabled()) return { ...noPrivileges };
  try {
    const client = await createClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user || !user.email || user.is_anonymous || !user.email_confirmed_at ||
      (expectedUserId !== undefined && user.id !== expectedUserId)) return { ...noPrivileges };
    const { data, error } = await client.rpc("makeborne_my_account_privileges");
    if (error || !data || data.userId !== user.id) return { ...noPrivileges };
    return { isAdmin: data.isAdmin === true, unlimitedCredits: data.unlimitedCredits === true };
  } catch {
    // Missing migrations, expired sessions and backend outages never grant access.
    return { ...noPrivileges };
  }
}
