import { redirect } from "next/navigation";
import { billingUser } from "@/lib/billing/access";
import { authDestination } from "@/lib/supabase/auth-flow";
import CheckoutReturn from "./return-client";
import "./return.css";

export const metadata = { title: "Confirming your membership" };
export const dynamic = "force-dynamic";
export default async function CheckoutReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const request = typeof query.request === "string" ? query.request : "";
  const destination = authDestination(`/billing/return?request=${encodeURIComponent(request)}`);
  if (destination === "/billing") redirect("/billing");
  if (!await billingUser()) redirect(`/login?next=${encodeURIComponent(destination)}`);
  return <CheckoutReturn requestId={request} />;
}
