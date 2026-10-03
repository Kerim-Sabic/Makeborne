import type { Kind, Style } from "../components/studio-model";

/** Authored colour/type directions. These do not claim generated artwork or layout parity. */
export const curatedStyles: { kind: Kind; style: Style }[] = [
  { kind: "website", style: { id: "brass-house", name: "Brass House", description: "Warm limestone, restrained brass and architectural serif headlines.", color: "#8A682A", background: "#F5F1E8", textColor: "#29291F", font: "serif" } },
  { kind: "website", style: { id: "electric-mint", name: "Electric Mint", description: "Midnight ink, luminous mint accents and crisp sans-serif type.", color: "#8FEBC8", background: "#142824", textColor: "#F0FAF4", font: "sans" } },
  { kind: "book", style: { id: "moss-notebook", name: "Moss Notebook", description: "Botanical greens, quiet cream pages and a literary reading rhythm.", color: "#456749", background: "#F4F3E8", textColor: "#263C2C", font: "serif" } },
  { kind: "book", style: { id: "ink-and-vermilion", name: "Ink & Vermilion", description: "A modern journal: black ink, paper white and sharp vermilion details.", color: "#B33826", background: "#FCF9F4", textColor: "#232122", font: "sans" } },
  { kind: "presentation", style: { id: "cobalt-study", name: "Cobalt Study", description: "Confident blue accents, pale ice backgrounds and precise sans-serif type.", color: "#254BD2", background: "#EDF2FD", textColor: "#172450", font: "sans" } },
  { kind: "presentation", style: { id: "plum-salon", name: "Plum Salon", description: "Deep plum, soft blush and expressive editorial serif headlines.", color: "#ECBCD4", background: "#342236", textColor: "#FBF2F6", font: "serif" } },
];
