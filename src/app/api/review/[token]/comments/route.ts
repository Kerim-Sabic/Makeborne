import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";
import { ReviewCommentInputSchema, ReviewCommentSchema } from "@/lib/client-review/contracts";
import { anonymousReviewDatabase, requireReviewToken, reviewDatabaseError } from "@/lib/client-review/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };

/** Public: a client without an account leaves a comment on a live review link. */
export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const token = requireReviewToken((await context.params).token);
    const parsed = ReviewCommentInputSchema.safeParse(await boundedJson(request, 8_000));
    if (!parsed.success) throw new RequestError("INVALID", parsed.error.issues[0]?.message ?? "Check your comment and try again.");
    const { data, error } = await anonymousReviewDatabase().rpc("makeborne_add_client_review_comment", {
      p_token: token, p_version: parsed.data.version, p_name: parsed.data.name, p_email: parsed.data.email, p_body: parsed.data.body, p_anchor: parsed.data.anchor,
    });
    reviewDatabaseError(error);
    return Response.json({ comment: ReviewCommentSchema.parse(data) }, { headers });
  } catch (error) {
    const response = apiError(error);
    Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  }
}
