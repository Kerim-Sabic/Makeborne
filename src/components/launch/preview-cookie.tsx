"use client";
import { useEffect } from "react";

/** `/?preview=site` remembers the owner's preview for a week on this browser; `/?preview=off` forgets it. No server state. */
export default function PreviewCookie({ mode }: { mode: "site" | "off" }) {
  useEffect(() => {
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = (mode === "site" ? "makeborne_launch_preview=site; max-age=604800" : "makeborne_launch_preview=; max-age=0") + `; path=/; samesite=lax${secure}`;
  }, [mode]);
  return null;
}
