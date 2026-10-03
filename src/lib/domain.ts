import { z } from "zod";

export const ArtifactKindSchema = z.enum(["website", "book", "presentation"]);
export const ProjectStatusSchema = z.enum([
  "draft",
  "in_progress",
  "review",
  "approved",
  "published",
  "archived",
]);
export const StyleIdSchema = z.enum(["editorial", "venture", "studio"]);
const id = z.string().uuid();
const text = z.string().trim();
const timestamp = z.string().datetime();
const optionalEmail = z.union([z.literal(""), z.string().email()]);
const optionalUrl = z.union([z.literal(""), z.string().url()]);

export const CreateClientSchema = z.object({
  name: text.min(1).max(120),
  company: text.max(160).default(""),
  email: optionalEmail.default(""),
  website: optionalUrl.default(""),
  notes: text.max(10000).default(""),
});
export const ClientSchema = CreateClientSchema.extend({
  id,
  createdAt: timestamp,
});
export type Client = z.infer<typeof ClientSchema>;
export type CreateClient = z.input<typeof CreateClientSchema>;

export const CreateProjectSchema = z.object({
  clientId: id.nullable().default(null),
  title: text.min(1).max(160),
  kind: ArtifactKindSchema,
  status: ProjectStatusSchema.default("draft"),
  styleId: StyleIdSchema.default("editorial"),
  brief: text.max(30000).default(""),
});
export const ProjectSchema = CreateProjectSchema.extend({
  id,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Project = z.infer<typeof ProjectSchema>;
export type CreateProject = z.input<typeof CreateProjectSchema>;

export const StyleProfileSchema = z.object({
  id: text.min(1),
  name: text.min(1).max(120),
  version: z.number().int().positive(),
  typography: z.object({ headingFont: text.min(1), bodyFont: text.min(1) }),
  colors: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)),
  description: text.max(5000),
  referenceAssetIds: z.array(id).default([]),
});
export type StyleProfile = z.infer<typeof StyleProfileSchema>;

export const ContentBlockSchema = z.object({
  id,
  type: z.enum([
    "heading",
    "paragraph",
    "image",
    "quote",
    "list",
    "table",
    "chart",
    "callout",
  ]),
  text: z.string().max(50000).default(""),
  assetId: id.nullable().default(null),
  locked: z.boolean().default(false),
  sourceIds: z.array(id).default([]),
});
export const ArtifactContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: text.min(1).max(200),
    kind: ArtifactKindSchema,
    sections: z.array(
      z.object({
        id,
        title: text.max(200),
        blocks: z.array(ContentBlockSchema),
      }),
    ),
  })
  .superRefine((content, context) => {
    const ids = new Set<string>();
    content.sections.forEach((section, sectionIndex) => {
      if (ids.has(section.id))
        context.addIssue({
          code: "custom",
          path: ["sections", sectionIndex, "id"],
          message: "Element IDs must be unique within an artifact.",
        });
      ids.add(section.id);
      section.blocks.forEach((block, blockIndex) => {
        if (ids.has(block.id))
          context.addIssue({
            code: "custom",
            path: ["sections", sectionIndex, "blocks", blockIndex, "id"],
            message: "Element IDs must be unique within an artifact.",
          });
        ids.add(block.id);
      });
    });
  });
export type ArtifactContent = z.infer<typeof ArtifactContentSchema>;
export const ArtifactSchema = z.object({
  id,
  projectId: id,
  kind: ArtifactKindSchema,
  title: text.min(1).max(200),
  currentVersion: z.number().int().nonnegative(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Artifact = z.infer<typeof ArtifactSchema>;
export const ArtifactVersionSchema = z.object({
  id,
  artifactId: id,
  number: z.number().int().positive(),
  parentVersionId: id.nullable(),
  content: ArtifactContentSchema,
  style: StyleProfileSchema,
  assetIds: z.array(id),
  createdAt: timestamp,
  createdBy: id,
  changeSummary: text.max(2000),
});
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;

export const SourceSchema = z.object({
  id,
  projectId: id,
  title: text.min(1).max(200),
  kind: z.enum(["text", "url", "document", "image", "recording"]),
  url: optionalUrl,
  assetId: id.nullable(),
  content: z.string().max(1000000),
  permission: z.enum(["private", "project", "public"]),
  approved: z.boolean(),
  createdAt: timestamp,
});
export type Source = z.infer<typeof SourceSchema>;
export const GenerationJobSchema = z.object({
  id,
  projectId: id,
  artifactId: id.nullable(),
  kind: ArtifactKindSchema,
  status: z.enum([
    "queued",
    "running",
    "awaiting_reconciliation",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  stage: text.max(120),
  attempt: z.number().int().nonnegative(),
  provider: text.max(80).nullable(),
  providerRequestId: text.max(200).nullable(),
  errorCode: text.max(100).nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type GenerationJob = z.infer<typeof GenerationJobSchema>;

export const StudioStateSchema = z.object({
  schemaVersion: z.literal(1),
  clients: z.array(ClientSchema),
  projects: z.array(ProjectSchema),
});
export type StudioState = z.infer<typeof StudioStateSchema>;
