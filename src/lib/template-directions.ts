import type { Kind, Style } from "@/components/studio-model";
import { curatedStyles } from "./curated-styles";

export type TemplateDirectionId =
  "form" | "signal" | "field" | "solstice" | "handbook" | "atlas" | "brass-house" | "electric-mint" | "moss-notebook" | "ink-and-vermilion" | "cobalt-study" | "plum-salon";
export type TemplateDirection = {
  id: TemplateDirectionId;
  title: string;
  description: string;
  kind: Kind;
  baseStyleId: "editorial" | "venture" | "studio";
  brief: string;
  style: Style;
};

/** Authored palette/type directions. The preview compositions are inspiration,
 * not a claim that the current renderer generates their complete layouts. */
export const templateDirections: TemplateDirection[] = [
  {
    id: "form",
    title: "Form architecture",
    description: "Quiet composition. A strong point of view.",
    kind: "website",
    baseStyleId: "editorial",
    brief:
      "Create an architecture portfolio with a warm ivory palette, spacious serif headings, a precise project grid and a contact page. Ask me for my actual projects and details; do not invent clients or awards.",
    style: {
      id: "direction-form",
      name: "Form architecture",
      description: "Warm ivory, olive ink and considered serif typography.",
      color: "#626857",
      background: "#EDECE5",
      textColor: "#33392E",
      font: "serif",
    },
  },
  {
    id: "signal",
    title: "Signal pitch deck",
    description: "An idea that gets straight to the point.",
    kind: "presentation",
    baseStyleId: "venture",
    brief:
      "Create a clear pitch presentation with charcoal backgrounds, a sharp lime accent, large typographic statements and disciplined supporting slides. Ask me for my idea, audience and verified figures before drafting.",
    style: {
      id: "direction-signal",
      name: "Signal pitch deck",
      description: "Charcoal canvas, warm white type and a sharp lime accent.",
      color: "#AFC96C",
      background: "#23261F",
      textColor: "#F5F3E7",
      font: "sans",
    },
  },
  {
    id: "field",
    title: "The Field Guide",
    description: "An editorial approach to useful knowledge.",
    kind: "book",
    baseStyleId: "editorial",
    brief:
      "Create a practical field guide with a typographic cover, generous reading margins, clear chapter structure and useful exercises. Ask me for the topic and approved source material. Keep illustrations purposeful and body text editable.",
    style: {
      id: "direction-field",
      name: "The Field Guide",
      description:
        "Paper cream, cobalt ink and expressive editorial serif typography.",
      color: "#274BBD",
      background: "#F8F7F1",
      textColor: "#274BBD",
      font: "serif",
    },
  },
  {
    id: "solstice",
    title: "Solstice creative studio",
    description: "Warm colour. Confident creative energy.",
    kind: "website",
    baseStyleId: "studio",
    brief:
      "Create a creative studio website with terracotta and cream, expressive serif headlines, an original work grid and a clear enquiry flow. Ask for real work samples and service information instead of inventing proof.",
    style: {
      id: "direction-solstice",
      name: "Solstice creative studio",
      description:
        "Warm peach, terracotta ink and expressive serif typography.",
      color: "#9E4431",
      background: "#F4D1BC",
      textColor: "#7F382D",
      font: "serif",
    },
  },
  {
    id: "handbook",
    title: "The better-work handbook",
    description: "Clean, precise and made to be read.",
    kind: "book",
    baseStyleId: "venture",
    brief:
      "Create a useful handbook with cobalt accents, precise typography, a clear contents page, concise chapters and practical worksheets. Ask me about the subject, reader and supplied material before writing.",
    style: {
      id: "direction-handbook",
      name: "The better-work handbook",
      description:
        "White reading pages, dark blue ink and precise cobalt accents.",
      color: "#3354CA",
      background: "#FFFFFF",
      textColor: "#1E2D4E",
      font: "sans",
    },
  },
  {
    id: "atlas",
    title: "Atlas workshop",
    description: "A thoughtful lesson, beautifully paced.",
    kind: "presentation",
    baseStyleId: "studio",
    brief:
      "Create an educational workshop deck with soft lavender, expressive dark typography, clear section markers and room for discussion. Ask for the learning outcomes, audience and lesson content. Preserve supplied wording when requested.",
    style: {
      id: "direction-atlas",
      name: "Atlas workshop",
      description:
        "Soft lavender, dark plum ink and a thoughtful serif hierarchy.",
      color: "#8F72A9",
      background: "#E8DEF2",
      textColor: "#362D41",
      font: "serif",
    },
  },
  ...curatedStyles.map(({ kind, style }): TemplateDirection => ({
    id: style.id as TemplateDirectionId,
    title: style.name,
    description: style.description,
    kind,
    baseStyleId: "editorial",
    style,
    brief: `Create a ${kind} using the ${style.name} visual direction: ${style.description} Use my supplied material and ask for missing facts. Do not invent claims or examples of client work.`,
  })),
];
