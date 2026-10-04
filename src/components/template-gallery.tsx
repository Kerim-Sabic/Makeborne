"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  BookOpen,
  LayoutTemplate,
  Presentation,
} from "lucide-react";
import "@/app/template-gallery.css";

import type { Kind, Style } from "@/components/studio-model";
import {
  templateDirections as directions,
  type TemplateDirection as Direction,
} from "@/lib/template-directions";
const filters: { label: string; value: Kind | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Websites", value: "website" },
  { label: "Books", value: "book" },
  { label: "Presentations", value: "presentation" },
];
const kindLabel = {
  website: "Website",
  book: "Book",
  presentation: "Presentation",
};
const kindIcon = {
  website: LayoutTemplate,
  book: BookOpen,
  presentation: Presentation,
};

function PreviewFrame({ direction }: { direction: Direction }) {
  return <div className={`mbg-preview mbg-generated-preview mbg-preview-${direction.id}`} aria-hidden="true">
    <Image src={`/gallery/${direction.id}.png`} alt="" fill sizes="(max-width: 700px) 92vw, (max-width: 1200px) 44vw, 32vw" />
    <span className="mbg-card-action"><ArrowUpRight size={19} /></span>
  </div>;
}
export default function TemplateGallery({
  onChoose,
  initialFilter = "all",
}: {
  initialFilter?: Kind | "all";
  onChoose?: (
    kind: Kind,
    brief: string,
    styleId: string,
    style?: Style,
  ) => void;
}) {
  const [filter, setFilter] = useState<Kind | "all">(initialFilter);
  const [error, setError] = useState("");
  const router = useRouter();
  const visible = directions.filter(
    (direction) => filter === "all" || direction.kind === filter,
  );
  function choose(direction: Direction) {
    if (onChoose)
      onChoose(direction.kind, direction.brief, direction.style.id, {
        ...direction.style,
      });
    else {
      try {
        const existing = sessionStorage.getItem("makeborne.creation-draft.v1");
        let priorBrief = "";
        if (existing) {
          const previous: unknown = JSON.parse(existing);
          if (
            !previous ||
            typeof previous !== "object" ||
            !("brief" in previous) ||
            typeof previous.brief !== "string"
          )
            throw new Error("Unreadable existing brief");
          priorBrief = previous.brief;
        }
        const brief =
          priorBrief.trim() && priorBrief !== direction.brief
            ? `${priorBrief}\n\nStyle direction:\n${direction.brief}`
            : direction.brief;
        if (brief.length > 20000) {
          setError(
            "Your existing brief is safely kept. Open it in the studio before adding another direction; the combined brief would exceed 20,000 characters.",
          );
          return;
        }
        sessionStorage.setItem(
          "makeborne.creation-draft.v1",
          JSON.stringify({
            kind: direction.kind,
            brief,
            styleId: direction.style.id,
            style: direction.style,
          }),
        );
        router.push(
          `/studio?${new URLSearchParams({ create: direction.kind, from: "home" }).toString()}`,
        );
      } catch {
        setError(
          "Your existing brief has not been replaced. Open the studio or copy your text before choosing this direction.",
        );
      }
    }
  }
  return (
    <section
      className="mbg-gallery"
      id="style-previews"
      aria-labelledby="mbg-title"
    >
      <div className="mbg-heading">
        <div>
          <span className="mbg-eyebrow">STYLE PREVIEWS</span>
          <h2 id="mbg-title">Start with a little inspiration.</h2>
        </div>
        <p>
          A direction for your next idea.
          <br />
          Make it your own in the studio.
        </p>
      </div>
      <div className="mbg-filter-row">
        <div className="mbg-filters" aria-label="Filter style previews">
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              className={
                filter === item.value
                  ? "mbg-filter mbg-filter-active"
                  : "mbg-filter"
              }
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="mbg-preview-note">
          Generated concepts · {visible.length} previews
        </span>
      </div>
      <div className="mbg-grid">
        {visible.map((direction) => {
          const Icon = kindIcon[direction.kind];
          return (
            <button
              type="button"
              className="mbg-card"
              key={direction.id}
              onClick={() => choose(direction)}
              aria-label={`Use ${direction.title} style for a ${kindLabel[direction.kind].toLowerCase()} project`}
            >
              <PreviewFrame direction={direction} />
              <div className="mbg-card-details">
                <div>
                  <h3>{direction.title}</h3>
                  <p>{direction.description}</p>
                </div>
                <span className="mbg-kind">
                  <Icon size={13} />
                  {kindLabel[direction.kind]}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {error && (
        <p className="mbg-gallery-error" role="alert">
          {error}
        </p>
      )}
      <p className="mbg-gallery-footnote">
        AI-generated design concepts, not finished templates or customer work. Your content and edits
        shape the finished project.
      </p>
    </section>
  );
}
