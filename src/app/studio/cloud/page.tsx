import CloudStudio from "@/components/cloud-studio";
import { requireCreationPage } from "@/lib/billing/access";
export const metadata = { title: "Cloud studio" };
export const dynamic = "force-dynamic";
export default async function CloudStudioPage() {
  await requireCreationPage("/studio/cloud");
  return <CloudStudio />;
}
