import { VersionedStyleSchema, type VersionedStyle } from "./schemas";

/** Authored version-one presets: output identities, not fabricated customer styles. */
export const ARTIFACT_STYLE_PRESETS: readonly VersionedStyle[] = [
  { schemaVersion: 1, id: "editorial", name: "Editorial", version: 1, scope: "preset", typography: { headingFont: "Source Serif 4", bodyFont: "Inter" }, colors: { canvas: "#F8F7F4", ink: "#16181D", accent: "#9B583C", muted: "#5C616D" }, description: "Warm paper, serif-led hierarchy, restrained imagery and generous reading margins.", referenceAssetIds: [], layout: { density: "spacious", radius: 8, maxColumns: 3 } },
  { schemaVersion: 1, id: "venture", name: "Venture", version: 1, scope: "preset", typography: { headingFont: "Inter", bodyFont: "Inter" }, colors: { canvas: "#F8F7F4", ink: "#16181D", accent: "#3358D4", muted: "#5C616D" }, description: "Confident contrast, precise grids, clear typography and disciplined data presentation.", referenceAssetIds: [], layout: { density: "balanced", radius: 8, maxColumns: 4 } },
  { schemaVersion: 1, id: "studio", name: "Studio", version: 1, scope: "preset", typography: { headingFont: "Inter", bodyFont: "Inter" }, colors: { canvas: "#F8F7F4", ink: "#16181D", accent: "#33544C", muted: "#5C616D" }, description: "Expressive imagery, deliberate asymmetry and distinctive editorial composition.", referenceAssetIds: [], layout: { density: "spacious", radius: 12, maxColumns: 3 } },
].map((style) => VersionedStyleSchema.parse(style));

export function findArtifactStyle(id: string, version: number): VersionedStyle | undefined {
  const style = ARTIFACT_STYLE_PRESETS.find((item) => item.id === id && item.version === version);
  return style ? structuredClone(style) : undefined;
}
