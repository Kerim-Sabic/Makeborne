import type { Metadata } from "next";
import CreationHome from "@/components/creation-home";
import { publicPageMetadata, SITE, siteStructuredData } from "@/lib/site-metadata";
import { CREATION_PLANS } from "@/lib/billing/plans";
import { billingUser } from "@/lib/billing/access";
import { accountsEnabled } from "@/lib/supabase/auth-server";
import { getFreeTierOffer } from "@/lib/credits/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...publicPageMetadata("/", SITE.title, SITE.description),
  title: { absolute: SITE.title },
};

export default async function Home() {
  const [user, freeTier] = await Promise.all([billingUser(), getFreeTierOffer()]);
  const website = siteStructuredData(CREATION_PLANS);

  return <>
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(website).replace(/</g, "\\u003c") }}
    />
    <CreationHome initialEmail={user?.email ?? null} accountsEnabled={accountsEnabled()} trialCredits={freeTier.enabled ? freeTier.trialCredits : null} />
  </>;
}
