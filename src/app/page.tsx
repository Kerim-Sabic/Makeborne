import type { Metadata } from "next";
import { cookies } from "next/headers";
import CreationHome from "@/components/launch/home-entry";
import LaunchScreen from "@/components/launch/launch-screen";
import PreviewCookie from "@/components/launch/preview-cookie";
import { publicPageMetadata, SITE, siteStructuredData } from "@/lib/site-metadata";
import { CREATION_PLANS } from "@/lib/billing/plans";
import { billingUser } from "@/lib/billing/access";
import { accountsEnabled } from "@/lib/supabase/auth-server";
import { getFreeTierOffer } from "@/lib/credits/server";
import { launchState, PREVIEW_COOKIE } from "@/lib/launch/config";
import { salesOpenNow } from "@/lib/launch/sales-open";
import { waitlistProof, waitlistProofCount } from "@/lib/launch/waitlist-count";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...publicPageMetadata("/", SITE.title, SITE.description),
  title: { absolute: SITE.title },
};

/** The home page's own tagline, also used on the launch screen. */
const TAGLINE = "Beautiful websites. Books worth opening. Slides that stay with you.";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, jar, user, freeTier] = await Promise.all([searchParams, cookies(), billingUser(), getFreeTierOffer()]);
  const website = siteStructuredData(CREATION_PLANS);
  const home = { initialEmail: user?.email ?? null, accountsEnabled: accountsEnabled(), trialCredits: freeTier.enabled ? freeTier.trialCredits : null };
  // Before launch `/` is the full-page countdown. `?preview=site` (remembered in a cookie) shows the normal home page.
  const launch = launchState(params.countdown);
  const preview = params.preview === "site" ? "site" : params.preview === "off" ? "off" : null;
  const bypass = preview === "site" || (preview !== "off" && jar.get(PREVIEW_COOKIE)?.value === "site");
  // Past launch time with plans still closed (a late cut-over), the screen stays up saying the doors open in a moment.
  const salesOpen = launch.enabled && launch.hold && launch.phase === "live" && !bypass ? await salesOpenNow() : null;
  const countdown = launch.enabled && !bypass && (launch.phase === "before" || salesOpen === false);
  // "Join N others": the real, cached count (only from 50, rounded down). Outside production `?waitlistCount=` previews it.
  const forcedCount = launch.testOverrides && typeof params.waitlistCount === "string" ? waitlistProof(Number(params.waitlistCount)) : undefined;
  const waitlistCount = countdown ? forcedCount !== undefined ? forcedCount : await waitlistProofCount() : null;

  return <>
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(website).replace(/</g, "\u003c") }}
    />
    {preview && <PreviewCookie mode={preview} />}
    {countdown
      ? <LaunchScreen launchAt={launch.launchAt} serverNow={launch.serverNow} text={launch.text} tagline={TAGLINE} home={home} testMode={launch.forced} theme={params.theme === "light" ? "light" : "dark"} waitlistCount={waitlistCount} hold={launch.hold} salesOpenAtRender={salesOpen} />
      : <CreationHome {...home} />}
  </>;
}
