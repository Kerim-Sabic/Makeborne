import type { CreationReference } from "../cloud/creation-reference";
import { ArtifactVersionSchema } from "../domain";
import { GenerationConsentSchema } from "./submission-contract";
import { readGenerationReference, saveGenerationReference } from "./browser-request";

/** Caller holds the account/artifact generation lock, shared with the editor.
 * Stage one generation request from the original explicitly consented Create.
 * Existing job references always win. Returning through an old creation link
 * cannot replace ongoing work or rotate the original request identity. */
export function stageCreationGeneration(storage: Pick<Storage,"getItem"|"setItem"|"removeItem">,
  creation: CreationReference, currentVersion: number, originalVersion: unknown) {
  if (!creation.generationConsent) return null;
  const consent = GenerationConsentSchema.parse(creation.generationConsent);
  const artifact = creation.artifact;
  if (!artifact || artifact.kind !== "website") throw Error("Save the website brief before starting creation.");
  const scope = {workspaceId:creation.workspaceId,projectId:artifact.projectId,artifactId:artifact.id};
  const existing = readGenerationReference(storage,creation.accountId,scope);
  if (existing) return existing;
  const version = ArtifactVersionSchema.parse(originalVersion);
  if (artifact.currentVersion !== 1 || currentVersion !== 1 || version.number !== 1 || version.artifactId !== artifact.id || version.createdBy !== creation.accountId)
    throw Error("This project has changed since its original prompt. Open the saved project to create from its current version.");
  const reference = {version:1 as const,accountId:creation.accountId,requestKey:creation.intentId,
    input:{scope,baseVersionId:version.id,sourceIds:[],...consent},prepared:null,jobId:null,autoStart:true};
  saveGenerationReference(storage,reference);
  return reference;
}
