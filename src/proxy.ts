import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = { matcher: ["/", "/admin", "/studio/:path*", "/chat", "/billing/:path*", "/auth/:path*", "/login", "/api/billing/:path*", "/api/cloud/:path*", "/api/workspaces", "/api/generate", "/api/export"] };
