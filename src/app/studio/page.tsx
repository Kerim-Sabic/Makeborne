import Studio from "@/components/studio";
import { pageDestination, requireCreationPage } from "@/lib/billing/access";
import { getAccountPrivileges } from "@/lib/account/privileges";
export const metadata = { title: "Studio" };
export const dynamic = "force-dynamic";
export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireCreationPage(pageDestination("/studio", await searchParams));
  const privileges = await getAccountPrivileges(user.id);
  return <Studio isAdmin={privileges.isAdmin} unlimitedCredits={privileges.unlimitedCredits} />;
}
