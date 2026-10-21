/**
 * Finish-time quality gates for generated websites: cheap, deterministic source
 * checks for contracts the eval kept finding broken (form feedback, page
 * orientation on multi-page sites, reduced motion, image dimensions). They run
 * only on files changed in this run, so a small edit to an older project is
 * never forced into unrelated rework. Messages say exactly what to add.
 */

export type QualityInput = {
  files: ReadonlyMap<string, string>;
  /** Paths written or edited in this run. */
  changed: ReadonlySet<string>;
  /** finish.routes (real page paths). */
  routes?: readonly { path: string }[];
};

const isScript = (path: string) => /\.(?:tsx|jsx|ts|js)$/.test(path);
const isStyle = (path: string) => path.endsWith(".css");
const join = (files: ReadonlyMap<string, string>, test: (path: string) => boolean) => [...files].filter(([path]) => test(path)).map(([, content]) => content).join("\n");

/** CSS with every block opened by `opener` (an @media prelude ending in "{") removed, braces matched. */
export function withoutBlocks(css: string, opener: RegExp) {
  let out = "", at = 0;
  for (const match of css.matchAll(opener)) {
    const start = match.index!;
    if (start < at) continue;
    let depth = 1, index = start + match[0].length;
    for (; index < css.length && depth > 0; index++) {
      if (css[index] === "{") depth++;
      else if (css[index] === "}") depth--;
    }
    out += css.slice(at, start);
    at = index;
  }
  return out + css.slice(at);
}

/** <img ...> tags (JSX attributes may span lines) whose src is a generated /images/ path. */
function generatedImagesWithoutSize(source: string) {
  const offenders: string[] = [];
  // JSX images are self-closing; matching to "/>" skips arrow functions inside attributes.
  for (const match of source.matchAll(/<img\b[\s\S]*?\/>/g)) {
    const tag = match[0];
    if (!/src=\{?\s*["'`]\/images\/[a-z0-9-]+\.webp/.test(tag)) continue;
    if (!/\bwidth=/.test(tag) || !/\bheight=/.test(tag)) offenders.push(/\/images\/[a-z0-9-]+\.webp/.exec(tag)?.[0] ?? "an image");
  }
  return offenders;
}

export function qualityProblems({ files, changed, routes = [] }: QualityInput): string[] {
  const problems: string[] = [];
  const touched = [...changed].filter(path => files.has(path));
  if (!touched.length) return problems;
  const scripts = join(files, isScript), styles = join(files, isStyle);
  const touchedScripts = touched.filter(isScript).map(path => [path, files.get(path)!] as const);

  // Forms: accessible error handling and success focus.
  const formFiles = touchedScripts.filter(([, content]) => /<form\b/.test(content)).map(([path]) => path);
  if (formFiles.length) {
    const missing = [
      !/aria-invalid/.test(scripts) && "aria-invalid on invalid fields",
      !/aria-describedby/.test(scripts) && "aria-describedby linking each invalid field to its error message",
      !/role=["'{]*alert/.test(scripts) && "an error summary with role=\"alert\" and tabIndex={-1}",
      !/\.focus\(/.test(scripts) && "focus moved to the error summary on a failed submit and to the success message after success",
    ].filter(Boolean);
    if (missing.length) problems.push(`${formFiles[0]} has a form without accessible feedback. Add ${missing.join("; ")} (see "Forms" in the system prompt).`);
    if (/\/_mb\/enquiries/.test(scripts) && !/role=["'{]*status/.test(scripts)) problems.push(`${formFiles[0]}: the confirmed-success message needs role="status" and tabIndex={-1}, and focus moves to it after accepted === true.`);
  }

  // Multi-page sites: page titles, focus after page changes and a not-found page.
  const multiPage = routes.length > 1 || touchedScripts.some(([, content]) => /addEventListener\(\s*["']hashchange["']/.test(content));
  if (multiPage && touchedScripts.length) {
    const missing = [
      !/document\.title\s*=/.test(scripts) && "set document.title for every page",
      !/\.focus\(/.test(scripts) && "move focus to the new page's h1 after a client-side page change",
      !/aria-live/.test(scripts) && "announce the new page in an aria-live=\"polite\" region",
      !/page not found/i.test(scripts) && "render a \"Page not found\" page (title and h1) with a link home for unknown paths",
    ].filter(Boolean);
    if (missing.length) problems.push(`This site has several pages: ${missing.join("; ")} (see "Multi-page sites" in the system prompt).`);
  }

  // Motion must have a reduced-motion fallback.
  const touchedStyles = touched.filter(isStyle).map(path => files.get(path)!).join("\n");
  if (/@keyframes|\[data-reveal|animation-timeline/.test(touchedStyles) && !/prefers-reduced-motion:\s*reduce/.test(styles)) {
    problems.push("The site animates but has no @media (prefers-reduced-motion: reduce) block: add the reduced-motion block from the motion pattern.");
  }
  if (/\[data-reveal[^{]*\{[^}]*opacity:\s*0(?![.\d])/.test(withoutBlocks(touchedStyles, /@media\s*\(\s*prefers-reduced-motion:\s*no-preference\s*\)\s*\{/g))) {
    problems.push("A [data-reveal] hidden state sits outside @media (prefers-reduced-motion: no-preference) and html.js: move it inside both gates so content is never stuck invisible.");
  }

  // Fixed or sticky bars and floating buttons at the bottom of the screen cover content (the judge
  // penalised them on every brief where they appeared); the sticky header carries the action.
  const bottomFixed = [...touchedStyles.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter(([, , body]) => /position:\s*(?:fixed|sticky)/.test(body) && /(?:^|[;\s])(?:bottom|inset-block-end):\s*(?:0|[0-9.]+(?:px|rem|em))/.test(body) && !/(?:^|[;\s])top:/.test(body))
    .map(([, selector]) => selector.trim().split(/\s*,\s*/).pop()!.slice(-60));
  if (bottomFixed.length) problems.push(`Remove the fixed bottom bar or floating button (${[...new Set(bottomFixed)].slice(0, 3).join(", ")}): it covers content on phones. Keep the action in the sticky header, the first screen and the closing section.`);

  // Generated images keep their returned size so nothing shifts.
  const unsized = touchedScripts.flatMap(([, content]) => generatedImagesWithoutSize(content));
  if (unsized.length) problems.push(`Give every generated image its width and height attributes (from the generate_image result): ${[...new Set(unsized)].slice(0, 4).join(", ")}.`);
  return problems;
}
