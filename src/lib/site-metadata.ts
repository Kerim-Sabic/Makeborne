/** Public identity shared by search metadata, the sitemap, and link previews. */
export const SITE = {
  name: "Makeborne",
  url: "https://makeborne.vercel.app",
  title: "Makeborne — Websites, books & presentations",
  description:
    "A creation and client workspace for websites, books, and presentations. Organize your briefs, edit your projects, and keep client work together.",
} as const;

export const IS_PREVIEW = process.env.VERCEL_ENV === "preview";
