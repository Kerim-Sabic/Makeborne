import { notFound } from "next/navigation";
import PortalSiteEditor from "@/components/portal/portal-site-editor";

export const dynamic = "force-dynamic";
export default async function Site({ params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(artifactId)) notFound();
  return <PortalSiteEditor artifactId={artifactId} />;
}
