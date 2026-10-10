import "server-only";
import {z} from "zod";
import {ArtifactContentSchema,StyleProfileSchema} from "../domain";
import {ScopeSchema} from "../jobs/contracts";
import {EffortLevelSchema} from "../routing/effort";
import {GenerationInputSchema} from "../routing/proposal";
import {validateDraftContext} from "./draft-contract";

const id=z.string().uuid(),kind=z.enum(['website','presentation']);
// Pick bounded public creative fields; do not forward internal database columns
// into prompts. Caller must load a consistent, currently authorized snapshot.
const SavedGenerationSchema=z.object({
  scope:ScopeSchema.extend({artifactId:id}),
  project:z.object({id,workspace_id:id,kind,brief:GenerationInputSchema.shape.brief,
    audience:GenerationInputSchema.shape.audience,purpose:GenerationInputSchema.shape.purpose,
    wording:GenerationInputSchema.shape.wording,effort:EffortLevelSchema,style_id:z.string().min(1).max(100)}),
  artifact:z.object({id,workspace_id:id,project_id:id,kind,current_version:z.number().int().positive()}),
  version:z.object({id,workspace_id:id,artifact_id:id,version_number:z.number().int().positive(),
    content:ArtifactContentSchema,style_snapshot:StyleProfileSchema,asset_manifest:z.array(id).max(1000)}),
  sources:z.array(z.object({id,workspace_id:id,project_id:id,approved:z.literal(true),
    title:z.string().max(200),content:z.string().max(20000)})).max(100),
}).strict();

/** One saved-state boundary shared by format-specific proposal builders. No
 * authorization, asset registration, database write or paid dispatch occurs. */
export function readSavedGenerationInput(records:unknown,expectedKind:z.infer<typeof kind>){
  const saved=SavedGenerationSchema.parse(records),{scope,project,artifact,version,sources}=saved;
  if(project.id!==scope.projectId||project.workspace_id!==scope.workspaceId
    ||project.kind!==expectedKind||artifact.kind!==expectedKind||version.content.kind!==expectedKind
    ||artifact.id!==scope.artifactId||artifact.project_id!==project.id||artifact.workspace_id!==scope.workspaceId
    ||version.artifact_id!==artifact.id||version.workspace_id!==scope.workspaceId
    ||version.version_number!==artifact.current_version||project.style_id!==version.style_snapshot.id
    ||sources.some(source=>source.workspace_id!==scope.workspaceId||source.project_id!==project.id)){
    throw new Error('Saved generation records do not match the current project revision.');
  }
  const input=GenerationInputSchema.parse({scope,baseVersionId:version.id,brief:project.brief,audience:project.audience,
    purpose:project.purpose,wording:project.wording,content:version.content,style:version.style_snapshot,sourceIds:sources.map(source=>source.id)});
  const context=validateDraftContext({input,presentationMode:expectedKind==='presentation'?'editable':null,
    availableAssetIds:version.asset_manifest,sourceMaterial:sources.map(source=>({id:source.id,title:source.title,text:source.content}))});
  return {input:context.input,effort:project.effort,context};
}
