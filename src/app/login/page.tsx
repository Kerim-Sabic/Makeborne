import AccountForm from "@/components/account-form";
import { redirect } from "next/navigation";
import { billingUser } from "@/lib/billing/access";
import { authDestination } from "@/lib/supabase/auth-flow";
export const metadata = { title: "Your account" };
export const dynamic = "force-dynamic";
export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, params] = await Promise.all([billingUser(), searchParams]);
  if (user) redirect(authDestination(typeof params.next === "string" ? params.next : null));
  return <AccountForm />;
}
