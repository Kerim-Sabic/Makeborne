import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (
    process.env.MAKEBORNE_CLOUD_ENABLED !== "true" ||
    process.env.MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED !== "true"
  )
    return NextResponse.redirect(
      new URL("/login?error=cloud-unavailable", url.origin),
    );
  const code = url.searchParams.get("code");
  if (code) {
    try {
      const client = await createClient();
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error)
        return NextResponse.redirect(new URL("/studio/cloud", url.origin));
    } catch {
      /* The user receives a safe recovery route. */
    }
  }
  return NextResponse.redirect(
    new URL("/login?error=confirmation", url.origin),
  );
}
