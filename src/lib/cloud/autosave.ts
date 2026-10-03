export type AutosaveState = { dirty: boolean; busy: boolean; conflict: boolean; uncertain: boolean; paused: boolean; recovery: boolean; reviewer: boolean; ready: boolean };
export function canAutosave(state: AutosaveState): boolean {
  return state.dirty && state.ready && !state.busy && !state.conflict && !state.uncertain && !state.paused && !state.recovery && !state.reviewer;
}
export function settleAccountSave(savedRevision: number, currentRevision: number, replayed: boolean) {
  if (!Number.isSafeInteger(savedRevision) || !Number.isSafeInteger(currentRevision) || savedRevision < 0 || currentRevision < savedRevision) throw new Error("Invalid editor revision.");
  const newerEdits = currentRevision !== savedRevision;
  return { newerEdits, clearRecovery: !newerEdits, pauseForReview: newerEdits && replayed };
}
