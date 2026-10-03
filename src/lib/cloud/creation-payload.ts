import { StudioProjectCreateSchema } from "./contracts";
import { accountStyleFromStudio } from "./editor-bridge";
import type { Kind, Style } from "@/components/studio-model";
import type { EffortLevel } from "../routing/effort";

export type CreationValues = { effort: EffortLevel; title: string; brief: string; audience: string; purpose: string; styleId: string; clientId: string; wording: string; content: string; kind: Kind };

/** Build once per submission; retain the returned IDs for every uncertain retry. */
export function buildCreationPayload(values: CreationValues, style: Style, id: () => string = () => crypto.randomUUID()) {
  const { content, clientId, ...project } = values;
  const paragraphs = content.split(/\n\s*\n/).filter(Boolean);
  const blocks = (paragraphs.length ? paragraphs : [values.title]).map((text, index) => ({
    id: id(), type: index === 0 ? "heading" : "paragraph", text,
    assetId: null, locked: false, sourceIds: [],
  }));
  return StudioProjectCreateSchema.parse({
    project: { ...project, clientId: clientId || null },
    content: { schemaVersion: 1, title: values.title, kind: values.kind, sections: [{ id: id(), title: values.title, blocks }] },
    style: accountStyleFromStudio(style),
  });
}
