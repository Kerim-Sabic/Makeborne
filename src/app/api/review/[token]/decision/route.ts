import { z } from "zod";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";
import { ReviewCommentSchema, ReviewDecisionInputSchema, ReviewDecisionSchema } from "@/lib/client-review/contracts";
import { anonymousReviewDatabase, requireReviewToken, reviewDatabaseError } from "@/lib/client-review/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
const Result = z.object({ decision: ReviewDecisionSchema, comment: ReviewCommentSchema });

/** Public: the client approves the work or asks for changes. */
export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const token = requireReviewToken((await context.params).token);
    const parsed = ReviewDecisionInputSchema.safeParse(await boundedJson(request, 8_000));
    if (!parsed.success) throw new RequestError("INVALID", parsed.error.issues[0]?.message ?? "Check the details and try again.");
    const { data, error } = await anonymousReviewDatabase().rpc("makeborne_decide_client_review", {
      p_token: token, p_name: parsed.data.name, p_email: parsed.data.email, p_decision: parsed.data.decision, p_note: parsed.data.note,
    });
    reviewDatabaseError(error);
    return Response.json(Result.parse(data), { headers });
  } catch (error) {
    const response = apiError(error);
    Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  }
}
