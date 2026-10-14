import { z } from "zod";
import { ArtifactSchema } from "../domain";
import { StudioProjectCreateSchema } from "./contracts";
import { GenerationConsentSchema } from "../generation/submission-contract";

const identity = z.string().uuid();
const ReferenceSchema = z.object({
  version: z.literal(1), accountId: identity, intentId: identity,
  workspaceId: identity, requestKey: identity, body: StudioProjectCreateSchema,
  artifact: ArtifactSchema.nullable(),
  generationConsent: GenerationConsentSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.generationConsent && value.body.project.kind !== "website")
    context.addIssue({ code: "custom", message: "Automatic website creation requires a website brief." });
  if (value.artifact && (value.artifact.kind !== value.body.project.kind || value.artifact.title !== value.body.project.title))
    context.addIssue({ code: "custom", message: "The saved project does not match its original request." });
});
export type CreationReference = z.infer<typeof ReferenceSchema>;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
export const creationReferenceKey = (accountId: string, intentId: string) =>
  `makeborne.creation-reference.v1.${identity.parse(accountId)}.${identity.parse(intentId)}`;

/** Keep completed references too: a delayed return link must reopen its original project. */
export function readCreationReference(storage: Storage, accountId: string, intentId: string) {
  const raw = storage.getItem(creationReferenceKey(accountId, intentId));
  if (raw === null) return null;
  try {
    if (raw.length > 3_000_000) throw Error();
    const reference = ReferenceSchema.parse(JSON.parse(raw));
    if (reference.accountId !== accountId || reference.intentId !== intentId) throw Error();
    return reference;
  } catch { throw Error("Your original project request could not be read. Its saved reference is preserved; do not start a replacement save."); }
}
function persist(storage: Storage, reference: CreationReference) {
  const checked = ReferenceSchema.parse(reference);
  try { storage.setItem(creationReferenceKey(checked.accountId, checked.intentId), JSON.stringify(checked)); }
  catch { throw Error("This browser could not preserve the original project request. Keep your brief and retry this same save after freeing storage."); }
}

/** Caller holds the account/intent Web Lock. The original payload AND key survive
 * reloads, confirmed-response storage failures and attachment handoff failures.
 * Existing server mutation receipts remain the sole write/replay authority. */
export async function continueProjectCreation(storage: Storage, accountId: string, intentId: string, boundary: {
  current: () => boolean;
  expectedWorkspaceId?: string;
  prepare: () => Promise<Pick<CreationReference, "workspaceId" | "body" | "generationConsent">>;
  submit: (reference: CreationReference) => Promise<unknown>;
}) {
  const assertCurrent = () => { if (!boundary.current()) throw Error("Your account changed. Reopen the original brief with the account that started it."); };
  assertCurrent();
  let reference = readCreationReference(storage, accountId, intentId);
  const assertWorkspace = (workspaceId: string) => {
    if (boundary.expectedWorkspaceId && workspaceId !== boundary.expectedWorkspaceId)
      throw Error("The original save belongs to another client workspace. Reopen it from Projects.");
  };
  if (!reference) {
    const prepared = await boundary.prepare(); assertCurrent();
    assertWorkspace(prepared.workspaceId);
    reference = ReferenceSchema.parse({ version: 1, accountId, intentId, requestKey: crypto.randomUUID(), ...prepared, artifact: null });
    persist(storage, reference);
  }
  assertWorkspace(reference.workspaceId);
  if (!reference.artifact) {
    assertCurrent();
    const artifact = ArtifactSchema.parse(await boundary.submit(reference)); assertCurrent();
    reference = ReferenceSchema.parse({ ...reference, artifact });
    persist(storage, reference);
  }
  assertCurrent();
  return reference as CreationReference & { artifact: z.infer<typeof ArtifactSchema> };
}
