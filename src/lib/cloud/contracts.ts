import { z } from "zod";
import { ArtifactContentSchema, ArtifactKindSchema, CreateClientSchema, CreateProjectSchema, StyleProfileSchema, type Client, type Project, type Artifact, type ArtifactVersion } from "@/lib/domain";

export type CloudRole = "owner" | "editor" | "reviewer";
export type CloudWorkspace = { id: string; name: string; role: CloudRole };
export type CloudClient = Client & { updatedAt: string };
export type CloudProject = Project & { audience: string; purpose: string; wording: string };
export type CloudArtifact = Artifact;
export type CloudVersion = ArtifactVersion;
export type CloudWorkspaceSnapshot = { workspace: CloudWorkspace; clients: CloudClient[]; projects: CloudProject[]; artifacts: CloudArtifact[] };

export const WorkspaceCreateSchema = z.object({ name: z.string().trim().min(1).max(160) }).strict();
export const CloudClientCreateSchema = CreateClientSchema.strict();
export const ClientUpdateSchema = z.object({
  name: CreateClientSchema.shape.name.optional(), company: CreateClientSchema.shape.company.removeDefault().optional(),
  email: CreateClientSchema.shape.email.removeDefault().optional(), website: CreateClientSchema.shape.website.removeDefault().optional(),
  notes: CreateClientSchema.shape.notes.removeDefault().optional(), expectedUpdatedAt: z.string().datetime(),
}).strict();
export const CloudProjectCreateSchema = CreateProjectSchema.extend({
  audience: z.string().max(1000).default(""), purpose: z.string().max(2000).default(""), wording: z.enum(["preserve", "improve", "summarise"]).default("preserve"),
}).strict();
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
