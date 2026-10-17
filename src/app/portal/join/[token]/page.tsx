import { notFound } from "next/navigation";
import PortalJoin from "@/components/portal/portal-join";

export const dynamic = "force-dynamic";
export default async function Join({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) notFound();
  return <PortalJoin token={token} />;
}
