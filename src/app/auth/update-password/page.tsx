import { redirect } from "next/navigation";
import { accountsEnabled } from "@/lib/supabase/auth-server";
import { getVerifiedUser } from "@/lib/supabase/server";
import UpdatePasswordForm from "./update-password-form";
import { authDestination } from "@/lib/supabase/auth-flow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Update your password", robots: { index: false, follow: false } };
export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams;
  const next = authDestination(typeof query.next === "string" ? query.next : null);
  if (!accountsEnabled()) redirect(`/login?error=cloud-unavailable&next=${encodeURIComponent(next)}`);
  const user = await getVerifiedUser();
  if (!user) redirect(`/login?error=confirmation&next=${encodeURIComponent(next)}`);
  return <UpdatePasswordForm next={next.startsWith("/auth/") ? "/studio" : next} />;
}
