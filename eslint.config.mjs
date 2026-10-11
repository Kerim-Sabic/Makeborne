import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local scratch, agent worktrees and environment folders (never committed).
    "work/**",
    ".claude/**",
    ".env*/**",
    // Generated output.
    "infra/**/worker-configuration.d.ts",
    "**/.wrangler/**",
    "public/generated/**", "public/builder-runtime/**",
    "docs/execution/evidence/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
