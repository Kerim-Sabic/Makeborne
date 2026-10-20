import { HardDrive, UserRound } from "lucide-react";
import { STORAGE_LABEL, type SettingStorage } from "@/lib/settings-storage";

/** "This device" or "Saved to your account", beside a setting's heading. */
export default function StorageLabel({ where }: { where: SettingStorage }) {
  return <span className={`settings-storage is-${where}`}>
    {where === "device" ? <HardDrive size={12} aria-hidden="true" /> : <UserRound size={12} aria-hidden="true" />}
    {STORAGE_LABEL[where]}
  </span>;
}
