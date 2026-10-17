import { cloudAccountGuard } from "./cloud-api";
import type { BrandKit } from "@/lib/brand/kit";

export type SavedBrandKit = { clientId: string | null; clientName?: string | null; kit: BrandKit; updatedAt: string };
export type BrandKitList = { available: boolean; canEdit: boolean; clients: { id: string; name: string }[]; kits: SavedBrandKit[] };

/** JSON request to the brand-kit routes, bound to the signed-in account. */
export async function brandRequest<T>(accountId: string, path: string, init?: RequestInit): Promise<T> {
  const guard = cloudAccountGuard(accountId);
  const response = await fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId, ...init?.headers } });
  const value = await response.json().catch(() => ({}));
  guard();
  if (!response.ok) throw new Error(value?.error?.message ?? "Something went wrong. Try again.");
  return value as T;
}
