import Studio from "@/components/studio";
import { pageDestination, requireCreationPage } from "@/lib/billing/access";
import { getAccountPrivileges } from "@/lib/account/privileges";
import { studioTab } from "@/lib/studio-navigation";
export const metadata = { title: "Studio" };
export const dynamic = "force-dynamic";
export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const user = await requireCreationPage(pageDestination("/studio", params));
  const privileges = await getAccountPrivileges(user.id);
  // The first paint shows the requested tab, not Projects then a jump.
  return <Studio isAdmin={privileges.isAdmin} unlimitedCredits={privileges.unlimitedCredits} initialTab={studioTab(typeof params.tab === "string" ? params.tab : null)} />;
}
