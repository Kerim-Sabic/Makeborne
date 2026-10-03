import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-serif", subsets: ["latin"] });
export const metadata: Metadata = {
  title: {
    default: "Makeborne — Make something worth selling",
    template: "%s · Makeborne",
  },
  description:
    "Your creation and client studio for websites, books, and presentations.",
  icons: { icon: "/brand/makeborne-mark.svg" },
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
