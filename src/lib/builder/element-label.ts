/**
 * A readable name for an element picked in the click-to-edit preview: what it
 * is, a few of its words and the page it is on, e.g.
 * `Heading "Explore our workshops" on Workshops (/workshops)`. The source file
 * and line stay available as secondary detail; this is only the label.
 */
const KINDS: Record<string, string> = {
  h1: "Heading", h2: "Heading", h3: "Heading", h4: "Heading", h5: "Heading", h6: "Heading",
  p: "Paragraph", a: "Link", button: "Button", img: "Image", picture: "Image", svg: "Icon", video: "Video",
  ul: "List", ol: "List", li: "List item", blockquote: "Quote", figure: "Figure", figcaption: "Caption",
  section: "Section", header: "Header", footer: "Footer", nav: "Navigation", main: "Main content", article: "Article", aside: "Sidebar",
  form: "Form", input: "Field", textarea: "Field", select: "Field", label: "Label", table: "Table",
  span: "Text", strong: "Text", em: "Text", small: "Text", div: "Block",
};

export const elementKind = (tag: string) => KINDS[tag.toLowerCase()] ?? "Element";

/** The first few words, cut at a word boundary. */
export function shortText(text: string, max = 40) {
  const words = text.replace(/\s+/g, " ").trim();
  if (words.length <= max) return words;
  const cut = words.slice(0, max - 1), space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, "")}…`;
}

export function elementLabel(input: { tag: string; text: string; page?: { title: string; path: string } | null }) {
  const words = shortText(input.text);
  const title = input.page?.title.trim();
  const where = !input.page ? "" : !title || title === input.page.path ? ` on ${input.page.path}` : ` on ${shortText(title, 40)} (${input.page.path})`;
  return `${elementKind(input.tag)}${words ? ` "${words}"` : ""}${where}`;
}
