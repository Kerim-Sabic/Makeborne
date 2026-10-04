import type { Metadata } from "next";
import { authDestination } from "@/lib/supabase/auth-flow";
import EmailConfirmation from "./email-confirmation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm your email", referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function VerifyEmail({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const tokenHash = typeof query.token_hash === "string" && query.token_hash.length <= 2048 ? query.token_hash : "";
  const type = query.type === "recovery" ? "recovery" : query.type === "email" ? "email" : null;
  const next = authDestination(typeof query.next === "string" ? query.next : null);
  return <EmailConfirmation tokenHash={tokenHash} type={type} next={next} />;
}
