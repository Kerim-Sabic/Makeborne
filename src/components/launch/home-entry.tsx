"use client";
import dynamic from "next/dynamic";

/**
 * The real home page as its own code-split chunk. It is still server-rendered whenever it is shown, but the launch
 * screen on `/` never downloads it until the reveal (or the owner's preview) needs it.
 */
const CreationHome = dynamic(() => import("@/components/creation-home"));
export default CreationHome;
