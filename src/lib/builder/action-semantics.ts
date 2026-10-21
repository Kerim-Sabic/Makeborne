/** One wording source for the builder's recovery-type actions. Each control
 * states, before it is used, which operation it touches, what happens to the
 * saved version and whether it can use credits. Stop, Continue, recovery,
 * Restore and the preview's Try again are different actions on purpose:
 * none of them is a generic "retry" of a paid request. */
import type { OperationSnapshot } from "./operation-contract";

type Operation = Pick<OperationSnapshot, "id" | "status" | "cancelRequested" | "canContinue" | "maximumAdditionalCredits" | "authorizedCredits" | "chargedCredits" | "recoverable">;

const shortId = (id: string) => id.slice(0, 8);
const credits = (count: number) => `${count} credit${count === 1 ? "" : "s"}`;

/** What the request is doing now, named the same way before and after a reload. */
export function operationPhase(operation: Operation | null, options: { recovery?: boolean; pendingCancel?: boolean } = {}) {
  if (!operation) return options.pendingCancel ? { label: "Stop requested", detail: "Waiting for the request to be recorded so Stop can be confirmed." } : null;
  const ref = `Request ${shortId(operation.id)}`;
  if (operation.status === "running" && operation.cancelRequested) return { label: "Stopping", detail: `${ref} is stopping. The recorded charge and returned credits settle next; nothing new starts.` };
  if (operation.status === "running") return { label: "Running", detail: `${ref} is running. Follow-ups are not queued: stop it or wait for it to finish before sending another message.` };
  if (operation.status === "cancelled") return { label: "Stopped", detail: `You stopped request ${shortId(operation.id)}. It can't be continued.${options.recovery ? " Its retained draft can still be reviewed and saved without another AI call." : " Send a new message to make more changes."}` };
  if (operation.status === "expired") return { label: "Expired", detail: `${ref} expired and can't be continued. Send a new message to make more changes.` };
  if (operation.status === "completed") return { label: "Finished", detail: `${ref} finished.${options.recovery ? " Its retained draft can be reviewed without another AI call." : ""}` };
  if (operation.canContinue && operation.maximumAdditionalCredits > 0) return { label: "Paused at its allowance", detail: `${ref} used its allowance before finishing. You can continue it with more credits, or leave it.` };
  return { label: "Waiting", detail: `${ref} is waiting for its recorded result.` };
}

/** Stop ends the same request; confirmed usage is charged, the rest is returned. */
export function stopEffect(operation: Pick<Operation, "id"> | null, version: number, retry = false) {
  const ref = operation ? `request ${shortId(operation.id)}` : "this request";
  return retry
    ? `Retry Stop sends Stop again for ${ref}. It can't start or charge anything new.`
    : `Stop ends ${ref}. Confirmed usage is charged and unused credits are returned. Version ${version} stays as saved unless the request already saved a newer one.`;
}

/** Continue keeps the operation, its files and its starting version; only the allowance grows. */
export function continueEffect(operation: Pick<Operation, "id" | "authorizedCredits" | "maximumAdditionalCredits">, version: number) {
  return `Continue keeps request ${shortId(operation.id)} and its original files, starting from version ${version}. It authorizes up to ${credits(operation.maximumAdditionalCredits)} more (new maximum ${credits(operation.authorizedCredits + operation.maximumAdditionalCredits)}). No new message is sent.`;
}

/** Saving a retained draft makes a new version from work that is already paid for. */
export function recoverEffect(version: number) {
  return `Previewing and saving the retained draft makes no AI call and uses no credits. Saving adds version ${version + 1} after checking that version ${version} is still current.`;
}

/** Restore copies an old version forward as a new one. It is a content
 * change only: no refund, and nothing outside the project is undone. */
export function restoreEffect(from: number, latest: number, website = false) {
  return `Restore saves a copy of version ${from} as new version ${latest + 1}. It uses no AI and no credits, and every version stays in history.${website ? " Your live website doesn't change until you publish again." : ""} It doesn't refund earlier usage or undo sent mail, received enquiries or payments.`;
}

export const CHECK_EFFECT = "Check saved result & charge only reads the recorded result. It never starts, repeats or charges anything.";

/** Preview-only actions: they re-render saved files or hand a message to the builder. */
export const PREVIEW_ACTIONS = {
  reload: { label: "Reload preview", effect: "Re-renders this page from the same files. No AI call, no credits." },
  retryPreview: { label: "Try again", effect: "Loads the preview again from the same saved files. No AI call, no credits, nothing regenerated." },
  fixError: { label: "Fix it", effect: "Asks the builder to fix this error: a new AI request that uses credits." },
} as const;
