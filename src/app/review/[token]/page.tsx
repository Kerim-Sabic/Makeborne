import type { Metadata } from "next";
import ClientReviewPage from "@/components/client-review-page";
import { ReviewPayloadSchema, validReviewToken, type ReviewPayload } from "@/lib/client-review/contracts";
import { anonymousReviewDatabase } from "@/lib/client-review/server";
import "@/app/client-review.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Review",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

async function load(token: string): Promise<ReviewPayload | null> {
  if (!validReviewToken(token)) return null;
  try {
    const { data, error } = await anonymousReviewDatabase().rpc("makeborne_read_client_review", { p_token: token });
    if (error || !data) return null;
    const parsed = ReviewPayloadSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** Public client review: no account, one artifact, token-scoped access. */
export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const review = await load(token);
  return <ClientReviewPage token={token} review={review} />;
}
