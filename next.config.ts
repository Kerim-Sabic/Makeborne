import type { NextConfig } from "next";

// Fail before Next can embed a mistakenly configured privileged key in browser code.
const publicSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (publicSupabaseKey && !publicSupabaseKey.startsWith("sb_publishable_")) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key. Privileged or legacy keys are not supported in browser configuration.",
  );
}

/** The files the PDF printer embeds (src/lib/documents/fonts-server.ts), latin and complementary latin-ext:
 * the static 400/600/700 cuts of every variable face in DOCUMENT_FACES (Chromium embeds variable fonts in
 * PDFs as Type 3), the single static Instrument Serif file, and the variable Archivo for its condensed
 * widths, which have no static cut (checked by src/lib/documents/check-design-quality.cjs). SUBSET is expanded below. */
const PRINT_CUT_FACES = ["fraunces", "playfair-display", "newsreader", "cormorant", "space-grotesk", "bricolage-grotesque", "sora", "geist", "inter", "dm-sans", "plus-jakarta-sans", "outfit", "archivo", "jetbrains-mono"];
const DOCUMENT_FONT_FILES = [
  ...PRINT_CUT_FACES.flatMap((id) => [400, 600, 700].map((weight) => `@fontsource/${id}/files/${id}-SUBSET-${weight}-*.woff2`)),
  "@fontsource/instrument-serif/files/instrument-serif-SUBSET-400-*.woff2",
  "@fontsource-variable/archivo/files/archivo-SUBSET-wdth-*.woff2",
].flatMap((file) => ["latin", "latin-ext"].map((subset) => `./node_modules/${file.replace("SUBSET", subset)}`));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PDF export runs Chromium; on Vercel it comes from @sparticuz/chromium's packed binary.
  // The builder compiles generated sites with esbuild-wasm, which locates its
  // WebAssembly service relative to its own files and cannot be bundled.
  serverExternalPackages: ["@sparticuz/chromium", "playwright", "playwright-core", "esbuild-wasm"],
  outputFileTracingIncludes: {
    // Compile check at the end of a website build (src/lib/builder/compile.ts):
    // the service runs bin/esbuild with node, which loads esbuild.wasm by path.
    "/api/build": ["./node_modules/esbuild-wasm/package.json", "./node_modules/esbuild-wasm/lib/main.js", "./node_modules/esbuild-wasm/bin/esbuild", "./node_modules/esbuild-wasm/wasm_exec*.js", "./node_modules/esbuild-wasm/esbuild.wasm"],
    "/admin": ["./node_modules/esbuild-wasm/package.json", "./node_modules/esbuild-wasm/lib/main.js", "./node_modules/esbuild-wasm/bin/esbuild", "./node_modules/esbuild-wasm/wasm_exec*.js", "./node_modules/esbuild-wasm/esbuild.wasm"],
    // Playwright loads its registry and runtime resources dynamically. Include
    // them explicitly for both export entry points in serverless deployments.
    "/api/export": ["./node_modules/@sparticuz/chromium/bin/**", "./node_modules/playwright-core/**/*", "./node_modules/playwright/**/*"],
    // Document PDFs embed their open-licensed faces (src/lib/documents/fonts.ts):
    // the serverless Chromium has only Open Sans, and fonts-server.ts reads these files.
    "/api/cloud/workspaces/*/artifacts/*/document-export": ["./node_modules/@sparticuz/chromium/bin/**", "./node_modules/playwright-core/**/*", "./node_modules/playwright/**/*", ...DOCUMENT_FONT_FILES],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Static preview runtime (React + bundler). Sandboxed previews have an
        // opaque origin, so module scripts need CORS. Contains no user data.
        source: "/builder-runtime/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
      {
        // Client review links carry a bearer token in the path: never index,
        // cache, or leak it through the Referer header.
        source: "/review/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      ...["studio", "chat", "login", "billing", "admin", "auth", "api"].map((route) => ({
        source: `/${route}/:path*`,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
    ];
  },
};

export default nextConfig;
