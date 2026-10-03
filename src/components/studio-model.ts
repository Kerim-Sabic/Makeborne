import { z } from "zod";
import {
  ClientSchema,
  ProjectSchema,
  type Client as DomainClient,
} from "@/lib/domain";
import { PanelTop, BookOpen, Presentation } from "lucide-react";
export type Kind = "website" | "book" | "presentation";
export type Block = {
  id: string;
  type: "heading" | "paragraph" | "image" | "quote";
  text: string;
  image?: string;
};
export type Client = DomainClient;
export type Style = {
  id: string;
  name: string;
  description: string;
  color: string;
  font: string;
  background?: string;
  textColor?: string;
};
export type Version = { id: string; at: string; blocks: Block[]; note: string };
export const ProjectTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  dueDate: z.iso.date().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ProjectTask = z.infer<typeof ProjectTaskSchema>;
export type Project = {
  id: string;
  title: string;
  kind: Kind;
  clientId: string | null;
  status:
    "draft" | "in_progress" | "review" | "approved" | "published" | "archived";
  styleId: string;
  brief: string;
  audience: string;
  purpose: string;
  wording: string;
  bookMetadata?: { author: string; language: string };
  tasks?: ProjectTask[];
  blocks: Block[];
  versions: Version[];
  activity: { at: string; text: string }[];
  createdAt: string;
  updatedAt: string;
};
export type Workspace = {
  schemaVersion: 1;
  projects: Project[];
  clients: Client[];
  styles: Style[];
  sound: boolean;
};
export const baseStyles: Style[] = [
  {
    id: "editorial",
    name: "Editorial",
    description: "Warm paper. Serif headlines. Room to breathe.",
    color: "#9b583c",
    font: "serif",
  },
  {
    id: "venture",
    name: "Venture",
    description: "Confident contrast. Precise grids. Clear ideas.",
    color: "#3358d4",
    font: "sans",
  },
  {
    id: "studio",
    name: "Studio",
    description: "Expressive composition. Distinctive character.",
    color: "#33544c",
    font: "sans",
  },
];
export const emptyWorkspace = (): Workspace => ({
  schemaVersion: 1,
  projects: [],
  clients: [],
  styles: baseStyles,
  sound: false,
});
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const icons = {
  website: PanelTop,
  book: BookOpen,
  presentation: Presentation,
};
export const kindLabel = {
  website: "Website",
  book: "Book",
  presentation: "Presentation",
};
export const storageKey = "makeborne.local-workspace.v1";
export function saveLocalWorkspace(workspace: Workspace, storage: Pick<Storage, "setItem">) {
  LocalWorkspaceSchema.parse(workspace);
  storage.setItem(storageKey, JSON.stringify(workspace));
}
const LocalBlockSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["heading", "paragraph", "image", "quote"]),
  text: z.string().max(50000),
  image: z
    .string()
    .max(4100000)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
    .optional(),
});
export const LocalStyleSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(120),
  description: z.string().max(5000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  font: z.enum(["serif", "sans"]),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
const LocalProjectSchema = ProjectSchema.extend({
  styleId: z.string().min(1).max(100),
  audience: z.string().max(5000),
  purpose: z.string().max(5000),
  wording: z.enum(["preserve", "improve", "summarise"]),
  tasks: z.array(ProjectTaskSchema).max(300).optional(),
  bookMetadata: z.object({
    author: z.string().max(200),
    language: z.string().max(64).regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
  }).optional(),
  blocks: z.array(LocalBlockSchema).max(500),
  versions: z
    .array(
      z.object({
        id: z.string().uuid(),
        at: z.string().datetime(),
        blocks: z.array(LocalBlockSchema).max(500),
        note: z.string().max(2000),
      }),
    )
    .max(100),
  activity: z
    .array(z.object({ at: z.string().datetime(), text: z.string().max(10000) }))
    .max(2000),
});
export const LocalWorkspaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    projects: z.array(LocalProjectSchema).max(1000),
    clients: z.array(ClientSchema).max(1000),
    styles: z.array(LocalStyleSchema).min(1).max(100),
    sound: z.boolean(),
  })
  .superRefine((workspace, context) => {
    const unique = (items: { id: string }[], path: (string | number)[]) => {
      const ids = new Set<string>();
      items.forEach((item, index) => {
        if (ids.has(item.id))
          context.addIssue({
            code: "custom",
            path: [...path, index, "id"],
            message: "Record IDs must be unique.",
          });
        ids.add(item.id);
      });
      return ids;
    };
    const clients = unique(workspace.clients, ["clients"]);
    const styles = unique(workspace.styles, ["styles"]);
    unique(workspace.projects, ["projects"]);
    workspace.projects.forEach((project, index) => {
      if (project.clientId && !clients.has(project.clientId))
        context.addIssue({
          code: "custom",
          path: ["projects", index, "clientId"],
          message: "The linked client is missing.",
        });
      if (!styles.has(project.styleId))
        context.addIssue({
          code: "custom",
          path: ["projects", index, "styleId"],
          message: "The selected style is missing.",
        });
      unique(project.blocks, ["projects", index, "blocks"]);
      unique(project.versions, ["projects", index, "versions"]);
      unique(project.tasks ?? [], ["projects", index, "tasks"]);
      project.versions.forEach((version, versionIndex) =>
        unique(version.blocks, [
          "projects",
          index,
          "versions",
          versionIndex,
          "blocks",
        ]),
      );
    });
  });
