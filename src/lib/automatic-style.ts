import type {Style} from "../components/studio-model";

/** A selection policy, not a visual template. Tokens are neutral editor fallbacks
 * until a project-specific direction has been generated and accepted. */
export const AUTOMATIC_STYLE: Readonly<Style> = Object.freeze({
  id: "automatic", name: "Designed for your idea",
  description: "An original visual direction shaped around your business, audience and brief.",
  color: "#3559D8", font: "sans", background: "#FFFFFF", textColor: "#202126",
});
