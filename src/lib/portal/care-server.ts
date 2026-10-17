import "server-only";
import { z } from "zod";
import { CareBillingSchema, type CareBilling } from "./care";
import { missingPortal, portalDatabaseError, type PortalTrusted } from "./server";

type Db = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };

/** Care plans per access id for the portal home. Before the care-plan migration: none. */
export async function readHomeBilling(db: Db, trusted: PortalTrusted): Promise<Record<string, CareBilling | null>> {
  const { data, error } = await db.rpc("makeborne_portal_billing_home", { ...trusted });
  if (missingPortal(error)) return {};
  portalDatabaseError(error);
  return z.record(z.string().uuid(), CareBillingSchema.nullable()).parse(data ?? {});
}

/** The care plan behind one site. Before the care-plan migration: none. */
export async function readSiteBilling(db: Db, trusted: PortalTrusted, artifactId: string): Promise<CareBilling | null> {
  const { data, error } = await db.rpc("makeborne_portal_billing_site", { ...trusted, p_artifact: artifactId });
  if (missingPortal(error)) return null;
  portalDatabaseError(error);
  return z.object({ billing: CareBillingSchema.nullable() }).parse(data).billing;
}
