/**
 * Where each Settings item is stored, said the same way everywhere (audit UX02). "device"
 * means this browser's local storage (studio-model's LocalWorkspace, saved by
 * saveLocalWorkspace); "account" means the server, so it follows the person to any device
 * where they sign in. src/lib/check-settings-storage.cjs ties each entry to its code path.
 * Client-safe.
 */
export type SettingStorage = "device" | "account";
export const STORAGE_LABEL: Readonly<Record<SettingStorage, string>> = Object.freeze({ device: "This device", account: "Saved to your account" });
export const SETTINGS_STORAGE = Object.freeze({
  accountProjects: "account",
  deviceWorkspace: "device",
  studioSounds: "device",
  websiteBadge: "account",
  yourData: "account",
} satisfies Record<string, SettingStorage>);
