import Studio from "@/components/studio";
import { pageDestination, requireCreationPage } from "@/lib/billing/access";
export const metadata = { title: "Studio" };
export const dynamic = "force-dynamic";
export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireCreationPage(pageDestination("/studio", await searchParams));
  return <Studio />;
}
