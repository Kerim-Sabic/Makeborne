import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import { SITE } from "@/lib/site-metadata";
import "./globals.css";
import "./account-refresh.css";
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-serif", subsets: ["latin"] });
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  applicationName: SITE.name,
  title: {
    default: SITE.title,
    template: "%s · Makeborne",
  },
  description: SITE.description,
  // App pages stay out of search unless a public page explicitly opts in.
  // Authentication and authorization remain responsible for protecting data.
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.title,
    description: SITE.description,
  },
  icons: { icon: "/brand/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
