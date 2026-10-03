import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabaseConfig } from "./config";

export async function createClient() {
  const { url, key } = requireSupabaseConfig();
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          /* Server Components cannot write cookies; the session proxy refreshes them. */
        }
      },
    },
  });
}

export async function getVerifiedUser() {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
}
