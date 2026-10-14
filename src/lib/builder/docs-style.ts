import "server-only";
import type { StyleProfile } from "../domain";
import { getStyleDesignInstructions } from "../style-design-instructions";
import { RequestError } from "../server/http";

/** Keep document presets and automatic guidance in the document's own format.
 * A mismatched saved preset must be corrected rather than silently discarded. */
export function documentStyleDirection(kind: "book" | "presentation", styleId: string, style?: Pick<StyleProfile, "name" | "description" | "colors" | "typography">) {
  try {
    return getStyleDesignInstructions(styleId, kind, style);
  } catch {
    throw new RequestError("INVALID_DOCUMENT_STYLE", `This visual style is not valid for a ${kind}. Choose a matching style or automatic art direction.`, 400);
  }
}
