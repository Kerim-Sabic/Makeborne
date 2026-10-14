import "server-only";
import {createHash} from "node:crypto";
import type {compileTrustedPublication} from "./publication-compiler";
import {renderHostedSnapshot} from "../hosting/snapshot";
import {serializeSiteFiles} from "../hosting/bundle";

type Compiled = Awaited<ReturnType<typeof compileTrustedPublication>>;
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const escapedPattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Compose from independently verified compiler/render output only. The portable
 * fallback is self-contained; the isolated page loads exact manifest CSS. */
export function composePublicationOutput(compiled: Compiled, presentation: {title: string; description: string; address: string; interactive: boolean}) {
  if (compiled.scripts.length !== 1) throw new Error("PUBLICATION_ENTRY_INVALID");
  const files = new Map(compiled.files.map(file => [file.path, file]));
  function composePage(snapshot:string, path:string, stylesheets:readonly string[]) {
  let css = "";
  for (const path of stylesheets) {
    const file = files.get(path);
    if (!file || !file.contentType.startsWith("text/css")) throw new Error("PUBLICATION_STYLE_INVALID");
    // Vite CSS may use relative references; resolve within its manifest path.
    const content = file.body.toString("utf8").replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (original, quote: string, reference: string) => {
      if (reference.startsWith("data:")) return original;
      const resolved = new URL(reference, `https://publication.invalid${path}`);
      if (resolved.origin !== "https://publication.invalid" || resolved.search || resolved.hash || !files.has(resolved.pathname)) throw new Error("PUBLICATION_STYLE_ASSET_INVALID");
      return `url(${quote}${resolved.pathname}${quote})`;
    });
    css += `\n${content}`;
  }
  if (/<\/style/i.test(css)) throw new Error("PUBLICATION_STYLE_INVALID");
  let portableSnapshot = snapshot.replace(/<\/head>/i, `<style data-makeborne-bundle>${css}</style></head>`);
  for (const file of compiled.files) {
    if (!file.contentType.startsWith("image/") && file.contentType !== "font/woff2") continue;
    const reference = new RegExp(`(["'(]\\s*)${escapedPattern(file.path)}(?=\\s*["')])`, "g");
    portableSnapshot = portableSnapshot.replace(reference, (_match, lead: string) => `${lead}data:${file.contentType};base64,${file.body.toString("base64")}`);
    if (Buffer.byteLength(portableSnapshot) > 3_900_000) throw new Error("PUBLICATION_PORTABLE_LIMIT");
  }
  const address = path === "/" ? presentation.address : `${presentation.address.replace(/\/$/, "")}${path}`;
  const html = renderHostedSnapshot(portableSnapshot, presentation.title, presentation.description, address, {requireReactRoot: true});
  const isolatedHtml = renderHostedSnapshot(snapshot, presentation.title, presentation.description, address,
    {assetPaths: compiled.assetPaths, stylesheets, requireReactRoot: true});
  return {path, html, isolatedHtml};
  }
  const routes = compiled.routeSnapshots.map(route => composePage(route.html, route.path, route.stylesheets));
  const root = routes.find(route => route.path === "/");
  if (!root || routes.reduce((total, route) => total + Buffer.byteLength(route.html) + Buffer.byteLength(route.isolatedHtml), 0) > 8_000_000) throw new Error("PUBLICATION_ROUTES_LIMIT");
  const output = {html: root.html, isolatedHtml: root.isolatedHtml, script: compiled.scripts[0], files: serializeSiteFiles(compiled.files), interactive: presentation.interactive, routes};
  const serializedOutput = JSON.stringify(output);
  return {output, serializedOutput, receipt: {...compiled.receipt, outputHash: digest(serializedOutput)}};
}
