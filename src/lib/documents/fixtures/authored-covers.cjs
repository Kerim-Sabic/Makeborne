/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic renderer fixtures, never model output. */
const { emptyDocument } = require("../editor.ts");
const { DocumentSourceSchema } = require("../schema.ts");
const text = (role, x, y, w, h, size, color = "ink", font = "heading") => ({ type: "text", role, x, y, w, h, size, color, font, weight: 400, align: "left", italic: false });
const line = (x1, y1, x2, y2, color = "accent", width = 0.35) => ({ type: "line", x1, y1, x2, y2, color, width });
const rect = (x, y, w, h, fill = "accent") => ({ type: "rect", x, y, w, h, fill, radius: 0 });
const specs = [
  { id: "tide", title: "Tide Tables", subtitle: "Reading the coast through water, weather and time", eyebrow: "A coastal field guide", fonts: "editorial",
    palette: { background: "#E7F0EC", surface: "#D6E5E1", ink: "#163833", muted: "#365950", accent: "#277668", accent2: "#B47E36", dark: "#163833" },
    bookMarks: Array.from({ length: 7 }, (_, i) => [line(8, 48 + i * 5, 45, 46 + i * 4, "accent", 0.28), line(45, 46 + i * 4, 91, 51 + i * 4, "accent", 0.28)]).flat(),
    slideMarks: Array.from({ length: 6 }, (_, i) => [line(65, 20 + i * 9, 79, 17 + i * 8, "accent", 0.3), line(79, 17 + i * 8, 94, 24 + i * 8, "accent", 0.3)]).flat(),
  },
  { id: "night", title: "Night Index", subtitle: "Independent sound after the city closes", eyebrow: "Music and urban culture", fonts: "condensed",
    palette: { background: "#151819", surface: "#25292B", ink: "#F2F3E9", muted: "#B6B9AF", accent: "#D8ED49", accent2: "#7777DE", dark: "#030505" },
    bookMarks: [12, 23, 16, 30, 22, 35, 19, 27].map((h, i) => rect(8 + i * 10.5, 82 - h, 6.5, h, i === 5 ? "accent2" : "accent")),
    slideMarks: [12, 23, 16, 30, 22, 35, 19, 27].map((h, i) => rect(65 + i * 3.6, 79 - h, 2.4, h, i === 5 ? "accent2" : "accent")),
  },
  { id: "grid", title: "The Living Grid", subtitle: "Rooms, thresholds and the spaces between", eyebrow: "Notes on architecture", fonts: "modern",
    palette: { background: "#F2EFE8", surface: "#DED9CF", ink: "#202323", muted: "#555853", accent: "#A63527", accent2: "#6C7E77", dark: "#202323" },
    bookMarks: [line(8, 49, 92, 49, "ink"), line(8, 49, 8, 81, "ink"), line(8, 81, 65, 81, "ink"), line(65, 81, 65, 58, "ink"), line(65, 58, 92, 58, "ink"), line(92, 58, 92, 49, "ink"), line(36, 49, 36, 70, "ink"), rect(36, 70, 29, 2)],
    slideMarks: [line(66, 20, 94, 20, "ink"), line(66, 20, 66, 78, "ink"), line(66, 78, 85, 78, "ink"), line(85, 78, 85, 39, "ink"), line(85, 39, 94, 39, "ink"), line(94, 39, 94, 20, "ink"), line(75, 20, 75, 58, "ink"), rect(75, 58, 10, 1.5)],
  },
];
function fixtures() {
  return specs.map(spec => {
    const theme = { palette: spec.palette, fonts: spec.fonts, mood: "Synthetic composition test", imageStyle: "" };
    const bookComposition = { version: 1, background: "background", elements: [...spec.bookMarks, text("eyebrow", 8, 7, 84, 6, 2.3, "muted", "body"), text("title", 8, 18, 84, 18, 12), text("subtitle", 8, 38, 80, 7, 3, "ink", "body"), text("author", 8, 89, 84, 5, 2.3, "muted", "body")] };
    const composition = { version: 1, background: "background", elements: [...spec.slideMarks, text("eyebrow", 7, 10, 49, 7, 2.2, "muted", "body"), text("title", 7, 26, 49, 31, 9), text("subtitle", 7, 65, 48, 17, 3, "ink", "body")] };
    if (spec.id === "grid") {
      // A genuinely different authored hierarchy: centered title above a plan,
      // with the reading line beneath it, rather than the other fixtures' split.
      const x = value => 25 + (value - 66) * 50 / 28, y = value => 38 + (value - 20) * 32 / 58;
      const marks = spec.slideMarks.map(mark => mark.type === "line" ? { ...mark, x1: x(mark.x1), x2: x(mark.x2), y1: y(mark.y1), y2: y(mark.y2) } : { ...mark, x: x(mark.x), y: y(mark.y), w: mark.w * 50 / 28, h: Math.max(1, mark.h * 32 / 58) });
      composition.elements = [...marks, { ...text("title", 7, 5, 86, 17, 8), align: "center" }, { ...text("eyebrow", 7, 25, 86, 6, 2.2, "muted", "body"), align: "center" }, { ...text("subtitle", 7, 82, 86, 12, 3, "ink", "body"), align: "center" }];
      bookComposition.elements = [...spec.bookMarks, { ...text("title", 8, 8, 84, 20, 11), align: "center" }, { ...text("eyebrow", 8, 30, 84, 6, 2.3, "muted", "body"), align: "center" }, { ...text("subtitle", 8, 38, 80, 7, 3, "ink", "body"), align: "center" }, { ...text("author", 8, 89, 84, 5, 2.3, "muted", "body"), align: "center" }];
    }
    const book = DocumentSourceSchema.parse({ ...emptyDocument("book", spec.title), theme, subtitle: spec.subtitle, author: "Synthetic author", cover: { tagline: spec.eyebrow, composition: bookComposition }, chapters: [{ id: "sample", title: "Synthetic chapter", text: "This is a renderer qualification fixture, not generated manuscript content." }] });
    const deck = DocumentSourceSchema.parse({ ...emptyDocument("deck", spec.title), theme, slides: ["cover", "closing"].map((layout, index) => ({ id: `${layout}-${spec.id}`, layout, tone: "light", title: spec.title, subtitle: index ? "Discuss the next chapter of this story" : spec.subtitle, eyebrow: index ? "Continue the conversation" : spec.eyebrow, composition, notes: "Synthetic fixture speaker notes." })) });
    return { id: spec.id, synthetic: true, book, deck };
  });
}
module.exports = { fixtures, text, line, rect };
