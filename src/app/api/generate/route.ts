import {
  apiError,
  boundedJson,
  RequestError,
  sameOrigin,
} from "@/lib/server/http";
import { z } from "zod";
import { requireCreationAccess } from "@/lib/billing/access";

const requestSchema = z.object({
  kind: z.enum(["website", "book", "presentation"]),
  brief: z.string().max(30000),
  audience: z.string().max(1000).optional(),
  purpose: z.string().max(2000).optional(),
  styleId: z.string().max(120),
  content: z.string().max(60000).optional(),
  mode: z.string().max(60).optional(),
});

// Paid production dispatch remains unavailable until durable reservations, provider
// reconciliation, tenant authorisation, and an explicit spending grant are installed.
// Presence of a key must never switch this endpoint into a billable route.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await requireCreationAccess();
    const parsed = requestSchema.safeParse(await boundedJson(request));
    if (!parsed.success)
      throw new RequestError(
        "INVALID_BRIEF",
        "Choose a supported format and supply a valid brief.",
      );
    throw new RequestError(
      "GENERATION_NOT_ENABLED",
      "Live AI generation is not enabled. You can create and edit your own content in this workspace.",
      503,
    );
  } catch (error) {
    return apiError(error);
  }
}
