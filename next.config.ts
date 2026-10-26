import type { NextConfig } from "next";

// Fail before Next can embed a mistakenly configured privileged key in browser code.
const publicSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (publicSupabaseKey && !publicSupabaseKey.startsWith("sb_publishable_")) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key. Privileged or legacy keys are not supported in browser configuration.",
  );
}

/** Latin and complementary latin-ext WOFF2 files for every face in DOCUMENT_FACES
 * (checked by src/lib/documents/check-design-quality.cjs). SUBSET is expanded below. */
const DOCUMENT_FONT_FILES = [
  "@fontsource-variable/fraunces/files/fraunces-SUBSET-opsz-*.woff2",
  "@fontsource/instrument-serif/files/instrument-serif-SUBSET-400-*.woff2",
  "@fontsource-variable/playfair-display/files/playfair-display-SUBSET-wght-*.woff2",
  "@fontsource-variable/newsreader/files/newsreader-SUBSET-wght-*.woff2",
  "@fontsource-variable/cormorant/files/cormorant-SUBSET-wght-*.woff2",
  "@fontsource-variable/space-grotesk/files/space-grotesk-SUBSET-wght-*.woff2",
  "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-SUBSET-opsz-*.woff2",
  "@fontsource-variable/sora/files/sora-SUBSET-wght-*.woff2",
  "@fontsource-variable/geist/files/geist-SUBSET-wght-*.woff2",
  "@fontsource-variable/inter/files/inter-SUBSET-opsz-*.woff2",
  "@fontsource-variable/dm-sans/files/dm-sans-SUBSET-wght-*.woff2",
  "@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-SUBSET-wght-*.woff2",
  "@fontsource-variable/outfit/files/outfit-SUBSET-wght-*.woff2",
  "@fontsource-variable/archivo/files/archivo-SUBSET-wdth-*.woff2",
  "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-SUBSET-wght-*.woff2",
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
  // Old and guessed pricing links land on the plans page (308, cached by clients and search engines).
  async redirects() {
    return [{ source: "/pricing", destination: "/billing", permanent: true }];
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
      // /billing and /billing/terms are public pricing pages listed in the sitemap, so only the
      // checkout return page under /billing is kept out of search here.
      ...["studio", "chat", "login", "billing/return", "admin", "auth", "api"].map((route) => ({
        source: `/${route}/:path*`,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
    ];
  },
};

export default nextConfig;
