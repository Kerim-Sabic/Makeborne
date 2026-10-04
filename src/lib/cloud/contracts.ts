import { z } from "zod";
import { ClientOutreachSchema } from "../client-outreach";
import { ArtifactContentSchema, ArtifactKindSchema, CreateClientSchema, CreateProjectSchema, StyleProfileSchema, type Client, type Project, type Artifact, type ArtifactVersion } from "../domain";

export type CloudRole = "owner" | "editor" | "reviewer";
export type CloudWorkspace = { id: string; name: string; role: CloudRole };
export const OutreachSummarySchema = ClientOutreachSchema.pick({ stage: true, nextFollowUp: true });
export type CloudClient = Client & { updatedAt: string; outreachSummary?: z.infer<typeof OutreachSummarySchema> };
export type CloudProject = Project & { audience: string; purpose: string; wording: string };
export type CloudArtifact = Artifact;
export type CloudVersion = ArtifactVersion;
export const ClientProjectItemSchema = z.object({
  projectId: z.string().uuid(), projectTitle: z.string(), projectStatus: z.string(),
  kind: ArtifactKindSchema, artifactId: z.string().uuid().nullable(), title: z.string(),
  version: z.number().int().nonnegative().nullable(), updatedAt: z.string().datetime(),
});
export type ClientProjectItem = z.infer<typeof ClientProjectItemSchema>;
export type CloudWorkspaceSnapshot = { workspace: CloudWorkspace; clients: CloudClient[]; projects: CloudProject[]; artifacts: CloudArtifact[] };

export const WorkspaceCreateSchema = z.object({ name: z.string().trim().min(1).max(160) }).strict();
export const CloudClientCreateSchema = CreateClientSchema.strict();
export const ClientUpdateSchema = z.object({
  outreach: ClientOutreachSchema.optional(),
  name: CreateClientSchema.shape.name.optional(), company: CreateClientSchema.shape.company.removeDefault().optional(),
  email: CreateClientSchema.shape.email.removeDefault().optional(), website: CreateClientSchema.shape.website.removeDefault().optional(),
  notes: CreateClientSchema.shape.notes.removeDefault().optional(), expectedUpdatedAt: z.string().datetime(),
}).strict();
export const CloudProjectCreateSchema = CreateProjectSchema.extend({
  styleId: z.string().min(1).max(100).default("editorial"),
  audience: z.string().max(1000).default(""), purpose: z.string().max(2000).default(""), wording: z.enum(["preserve", "improve", "summarise"]).default("preserve"),
}).strict();
export const StudioProjectCreateSchema = z.object({
  project: CloudProjectCreateSchema.extend({ effort: z.enum(["light", "medium", "high", "super_high", "ultra"]).default("medium") }),
  content: ArtifactContentSchema, style: StyleProfileSchema,
}).strict().refine(value => value.project.kind === value.content.kind && value.project.title === value.content.title && value.project.styleId === value.style.id, "Project and content must match.");
export const ProjectUpdateSchema = z.object({
  clientId: CreateProjectSchema.shape.clientId.removeDefault().optional(), title: CreateProjectSchema.shape.title.optional(),
  status: CreateProjectSchema.shape.status.removeDefault().optional(), styleId: CreateProjectSchema.shape.styleId.removeDefault().optional(),
  brief: CreateProjectSchema.shape.brief.removeDefault().optional(), audience: z.string().max(1000).optional(),
  purpose: z.string().max(2000).optional(), wording: z.enum(["preserve", "improve", "summarise"]).optional(),
  expectedUpdatedAt: z.string().datetime(),
}).strict();
export const ArtifactCreateSchema = z.object({ title: z.string().trim().min(1).max(200), kind: ArtifactKindSchema }).strict();
export const VersionSaveSchema = z.object({
  expectedVersion: z.number().int().nonnegative(), content: ArtifactContentSchema, style: StyleProfileSchema,
  assetIds: z.array(z.string().uuid()).max(1000).default([]), changeSummary: z.string().max(2000).default(""),
}).strict();
