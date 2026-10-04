import type { Metadata } from "next";
import CreationHome from "@/components/creation-home";
import { publicPageMetadata, SITE } from "@/lib/site-metadata";

export const metadata: Metadata = {
  ...publicPageMetadata("/", SITE.title, SITE.description),
  title: { absolute: SITE.title },
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
