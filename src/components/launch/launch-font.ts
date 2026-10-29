import localFont from "next/font/local";

/**
 * Geist (SIL Open Font License 1.1, from @fontsource-variable/geist, Latin subset) for the launch screen only:
 * a modern display grotesk with tight figures. next/font preloads it on `/` and sizes a metric-matched fallback,
 * so the swap never shifts the layout.
 */
export const launchFont = localFont({
  src: "./fonts/geist-latin-wght.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-launch",
  fallback: ["Inter", "Arial", "sans-serif"],
});
