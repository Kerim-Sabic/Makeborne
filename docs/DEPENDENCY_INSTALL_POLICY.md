# Dependency install scripts

Reviewed 4 October 2026.

`unrs-resolver@1.12.2` is an indirect ESLint dependency. Its `postinstall.js` calls `napi-postinstall@0.3.4` to check or recover a native resolver binding. The lockfile already declares the versioned platform bindings as optional packages.

The project explicitly denies the fallback install script in `package.json` (`allowScripts.unrs-resolver: false`). Modern npm records this as a reviewed decision instead of warning about an unreviewed package. This is not a blanket approval of dependency scripts. Keep optional dependencies installed; do not add `--omit=optional`.

Vercel runs ESLint before the production build. This exercises the resolver on the actual Linux build environment and catches a missing native binding before deployment. A platform or lockfile change must pass that check before relying on the same decision.

Older npm versions that do not implement `allowScripts` ignore the field. For a clean install with those versions, use `npm ci --ignore-scripts`, followed by `npm run lint` and `npm run build`. Do not delete the lockfile to silence a warning.

Reference: https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/
