# Dependency review — 2026-10-03

Production dependency audit after upgrading transitive image-size to 2.0.4: npm audit --omit=dev reports zero known vulnerabilities at this time. This is a registry advisory check, not a security certification.

Full audit still reports five high severity development-tool findings in the Next ESLint fast-glob/micromatch/braces chain. The registry currently returns braces 3.0.3 as latest; no blind incompatible downgrade or forced fix was applied. Revisit upstream patch availability before the production release. Lint glob input must not be customer supplied.
