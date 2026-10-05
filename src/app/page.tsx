import type { Metadata } from "next";
import CreationHome from "@/components/creation-home";
import { publicPageMetadata, SITE } from "@/lib/site-metadata";
import { billingUser } from "@/lib/billing/access";
import { accountsEnabled } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...publicPageMetadata("/", SITE.title, SITE.description),
  title: { absolute: SITE.title },
};

export default async function Home() {
  const user = await billingUser();
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE.url}/#website`,
    name: SITE.name,
    url: SITE.url,
    description: SITE.description,
    inLanguage: "en",
  };

  return <>
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(website).replace(/</g, "\\u003c") }}
    />
    <CreationHome initialEmail={user?.email ?? null} accountsEnabled={accountsEnabled()} />
  </>;
}
