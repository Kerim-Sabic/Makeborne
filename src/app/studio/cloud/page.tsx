import CloudStudio from "@/components/cloud-studio";
import { requireCreationPage } from "@/lib/billing/access";
export const metadata = { title: "Saved account records" };
export const dynamic = "force-dynamic";
export default async function CloudStudioPage() {
  await requireCreationPage("/studio/cloud");
  return <CloudStudio />;
}
