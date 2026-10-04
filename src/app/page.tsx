import type { Metadata } from "next";
import CreationHome from "@/components/creation-home";
import { IS_PREVIEW, SITE } from "@/lib/site-metadata";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  robots: { index: !IS_PREVIEW, follow: !IS_PREVIEW },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    url: "/",
    locale: "en_US",
  },
};

export default function Home() {
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
    <CreationHome />
  </>;
}
