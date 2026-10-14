import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site-metadata";

/** Web app manifest: name, colours and icon when Makeborne is installed or pinned. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.description,
    start_url: "/studio",
    scope: "/",
    display: "standalone",
    background_color: "#faf9f6",
    theme_color: "#5b44a0",
    icons: [{ src: "/brand/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
