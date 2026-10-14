import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { releaseMaintenanceResponse } from "@/lib/release-maintenance";

export function proxy(request: NextRequest) {
  const maintenance = releaseMaintenanceResponse(request, process.env.MAKEBORNE_RELEASE_MAINTENANCE);
  if (maintenance) return maintenance;
  // Cover every API for maintenance without changing normal session/cache
  // behavior on public snapshots, signed webhooks or worker endpoints.
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/") && !/^\/api\/(billing(?:\/|$)|cloud(?:\/|$)|workspaces$|generate$|export$)/.test(path)) return NextResponse.next();
  return updateSession(request);
}

export const config = { matcher: ["/", "/admin", "/studio/:path*", "/chat", "/billing/:path*", "/auth/:path*", "/login", "/api/:path*"] };
