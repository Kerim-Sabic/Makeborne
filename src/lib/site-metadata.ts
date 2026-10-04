import type { Metadata } from "next";

/** Public identity shared by search metadata, the sitemap, and link previews. */
export const SITE = {
  name: "Makeborne",
  url: "https://makeborne.vercel.app",
  title: "Makeborne — Websites, books & presentations",
  description:
    "A creation and client workspace for websites, books, and presentations. Organize your briefs, edit your projects, and keep client work together.",
} as const;

export const IS_PREVIEW = process.env.VERCEL_ENV === "preview";

/** Only public, useful pages belong here. Never add customer projects or account URLs. */
export const PUBLIC_PATHS = ["/", "/help"] as const;

export const PUBLIC_ROBOTS: Metadata["robots"] = {
  index: !IS_PREVIEW,
  follow: !IS_PREVIEW,
  googleBot: {
    index: !IS_PREVIEW,
    follow: !IS_PREVIEW,
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
  },
};

export function publicPageMetadata(path: typeof PUBLIC_PATHS[number], title: string, description: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: PUBLIC_ROBOTS,
    openGraph: {
      type: "website",
      siteName: SITE.name,
      title,
      description,
      url: path,
      locale: "en_US",
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: SITE.title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: "/opengraph-image", alt: SITE.title }],
    },
  };
}
