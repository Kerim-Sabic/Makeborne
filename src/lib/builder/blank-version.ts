import { randomUUID } from "node:crypto";
import { ArtifactContentSchema, StyleProfileSchema, type ArtifactVersion } from "../domain";
import { baseStyles } from "../../components/studio-model";

/** Shared initial view for generation and planning before the first saved version. */
export function blankVersion(artifactId: string, kind: string, title: string, userId: string): ArtifactVersion {
  const style = baseStyles[0];
  return {
    id: randomUUID(), artifactId, number: 0, parentVersionId: null, createdAt: new Date().toISOString(), createdBy: userId, assetIds: [], changeSummary: "",
    content: ArtifactContentSchema.parse({ schemaVersion: 1, title: title.slice(0, 200) || "Untitled", kind, sections: [] }),
    style: StyleProfileSchema.parse({ id: style.id, name: style.name, version: 1, typography: { headingFont: "Source Serif 4", bodyFont: "Inter" },
      colors: { accent: style.color, ink: "#16181D", canvas: "#F8F7F4" }, description: style.description, referenceAssetIds: [] }),
  };
}
