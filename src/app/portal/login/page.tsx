import PortalLoginPage from "@/components/portal/portal-login-page";

export const dynamic = "force-dynamic";
export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = (await searchParams).next;
  // Only portal destinations; anything else lands on the portal home.
  const target = typeof next === "string" && /^\/portal(?:\/sites\/[0-9a-f-]{36})?$/.test(next) ? next : "/portal";
  return <PortalLoginPage next={target} />;
}
