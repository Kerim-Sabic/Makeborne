import type { NextConfig } from "next";

// Fail before Next can embed a mistakenly configured privileged key in browser code.
const publicSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (publicSupabaseKey && !publicSupabaseKey.startsWith("sb_publishable_")) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key. Privileged or legacy keys are not supported in browser configuration.",
  );
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PDF export runs Chromium; on Vercel it comes from @sparticuz/chromium's packed binary.
  serverExternalPackages: ["@sparticuz/chromium", "playwright", "playwright-core"],
  outputFileTracingIncludes: {
    // Playwright loads its registry and runtime resources dynamically. Include
    // them explicitly for both export entry points in serverless deployments.
    "/api/export": ["./node_modules/@sparticuz/chromium/bin/**", "./node_modules/playwright-core/**/*", "./node_modules/playwright/**/*"],
    "/api/cloud/workspaces/*/artifacts/*/document-export": ["./node_modules/@sparticuz/chromium/bin/**", "./node_modules/playwright-core/**/*", "./node_modules/playwright/**/*"],
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
