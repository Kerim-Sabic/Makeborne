import { redirect } from "next/navigation";
import { accountsEnabled } from "@/lib/supabase/auth-server";
import { getVerifiedUser } from "@/lib/supabase/server";
import UpdatePasswordForm from "./update-password-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Update your password — Makeborne", robots: { index: false, follow: false } };
export default async function UpdatePasswordPage() {
  if (!accountsEnabled()) redirect("/login?error=cloud-unavailable");
  const user = await getVerifiedUser();
  if (!user) redirect("/login?error=confirmation");
  return <UpdatePasswordForm />;
}
