import "server-only";
import { billingDatabase } from "./database";
import { configuredCreationOffers } from "./creation-offers";

/** False before launch: no configured plan passes the database plan gate. Advisory only; checkout rechecks. */
export async function plansOnSale(offers: ReturnType<typeof configuredCreationOffers> = safeOffers()): Promise<boolean> {
  if (!offers.length) return false;
  try {
    const { data, error } = await billingDatabase().rpc("makeborne_billing_creation_enabled", { p_plan_id: offers[0].planId });
    return !error && data === true;
  } catch { return false; }
}

function safeOffers() {
  try { return configuredCreationOffers(); } catch { return []; }
}
