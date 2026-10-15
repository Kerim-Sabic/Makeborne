import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/app/portal.css";

export const metadata: Metadata = { title: "Client portal", robots: { index: false, follow: false } };

export default function PortalLayout({ children }: { children: ReactNode }) {
  return children;
}
