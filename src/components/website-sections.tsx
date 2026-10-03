"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import type { Block } from "./studio-model";
const sections = [
  {
    id: "hero",
    name: "Hero",
    heading: "Your main promise",
    body: "Describe the real benefit you offer and who it is for. Add your own clear next step.",
  },
  {
    id: "services",
    name: "Services",
    heading: "How we can help",
    body: "List your actual services, who each is for, and what is included. Replace this guidance with verified information.",
  },
  {
    id: "features",
    name: "Features",
    heading: "Thoughtfully made for you",
    body: "Explain the useful capabilities of your real product. Use specific benefits and avoid unsupported claims.",
  },
  {
    id: "gallery",
    name: "Gallery / portfolio",
    heading: "Selected work",
    body: "Add approved examples of your work and upload the relevant artwork. Explain the context and your actual contribution.",
  },
  {
    id: "testimonials",
    name: "Verified testimonials",
    heading: "In their own words",
    body: "Add a genuine quote only with the speaker’s permission. Include their approved name and context. Do not publish this guidance as a testimonial.",
  },
  {
    id: "faq",
    name: "Frequently asked questions",
    heading: "A little more clarity",
    body: "Question: What should a customer know before buying?\nAnswer: Add an accurate response.\n\nQuestion: What happens next?\nAnswer: Describe your actual delivery process.",
  },
  {
    id: "contact",
    name: "Contact",
    heading: "Let’s start a conversation",
    body: "Add your approved contact details and preferred next step. A working form requires a configured destination.",
  },
  {
    id: "footer",
    name: "Footer information",
    heading: "The details that matter",
    body: "Add your legal business name, contact information, and links to applicable policies.",
  },
];
export default function WebsiteSections({
  add,
}: {
  add: (blocks: Omit<Block, "id">[]) => void;
}) {
  const [selected, setSelected] = useState("hero");
  const section = sections.find((s) => s.id === selected)!;
  return (
    <div className="website-sections">
      <h3>Build a complete page</h3>
      <p>
        Reusable section scaffolds. Add your own facts and approved artwork.
      </p>
      <label>
        Section
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button secondary small"
        onClick={() =>
          add([
            { type: "heading", text: section.heading },
            {
              type: section.id === "testimonials" ? "quote" : "paragraph",
              text: section.body,
            },
          ])
        }
      >
        <Plus size={14} /> Add {section.name.toLowerCase()}
      </button>
    </div>
  );
}
