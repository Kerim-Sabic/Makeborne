"use client";

import { useEffect, useRef, useState } from "react";
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

function FormPreview() {
  return (
    <div className="mbg-form">
      <div className="mbg-mini-nav">
        <strong>FORM.</strong>
        <span>Selected work &nbsp;&nbsp; Studio &nbsp;&nbsp; Contact ↗</span>
      </div>
      <div className="mbg-form-heading">
        Spaces with
        <br />
        <i>something to say.</i>
      </div>
      <div className="mbg-form-bottom">
        <div className="mbg-building">
          <div />
          <div />
          <div />
        </div>
        <div className="mbg-form-caption">
          <span>
            AN ARCHITECTURAL
            <br />
            POINT OF VIEW.
          </span>
          <p>
            Considered spaces.
            <br />
            Lasting impressions.
          </p>
          <span className="mbg-mini-link">Explore the work ↗</span>
        </div>
      </div>
      <div className="mbg-form-footer">
        ARCHITECTURE & INTERIORS <span>01 / SELECTED DIRECTION</span>
      </div>
    </div>
  );
}
function SignalPreview() {
  return (
    <div className="mbg-signal">
      <div className="mbg-mini-nav">
        <strong>SIGNAL</strong>
        <span>A NEW POINT OF VIEW / 01</span>
      </div>
      <div className="mbg-signal-copy">
        <span className="mbg-signal-kicker">LET’S MAKE IT CLEAR.</span>
        <h3>
          Big ideas.
          <br />
          <span>Real impact.</span>
        </h3>
        <p>A sharper story for what comes next.</p>
      </div>
      <div className="mbg-signal-orbit">
        <div />
        <div />
        <div />
        <span />
      </div>
      <div className="mbg-signal-footer">
        <span>THE OPENING SLIDE</span>
        <span>↗</span>
      </div>
    </div>
  );
}
function FieldPreview() {
  return (
    <div className="mbg-field">
      <div className="mbg-field-page">
        <span className="mbg-book-eyebrow">A PRACTICAL COMPANION</span>
        <h3>
          The
          <br />
          <i>Field</i>
          <br />
          Guide.
        </h3>
        <div className="mbg-field-line" />
        <p>
          Turn what you know
          <br />
          into something useful.
        </p>
        <div className="mbg-field-imprint">
          KNOWLEDGE, PUT TO WORK.<span>VOL. 01</span>
        </div>
      </div>
      <div className="mbg-field-spine">THE FIELD GUIDE</div>
    </div>
  );
}
function SolsticePreview() {
  return (
    <div className="mbg-solstice">
      <div className="mbg-mini-nav">
        <strong>solstice*</strong>
        <span>Work &nbsp;&nbsp; About &nbsp;&nbsp; Let’s talk ↗</span>
      </div>
      <h3>
        A little bold.
        <br />A lot <i>of heart.</i>
      </h3>
      <div className="mbg-solstice-row">
        <p>
          A creative direction
          <br />
          with a warmer outlook.
        </p>
        <span className="mbg-solstice-pill">Discover the studio ↗</span>
      </div>
      <div className="mbg-solstice-art">
        <div className="mbg-solstice-sun" />
        <div className="mbg-solstice-shape" />
        <span>A DIFFERENT KIND OF CREATIVE ENERGY.</span>
      </div>
    </div>
  );
}
function HandbookPreview() {
  return (
    <div className="mbg-handbook">
      <div className="mbg-handbook-cover">
        <div className="mbg-mini-nav">
          <strong>THE PRACTICAL SERIES</strong>
          <span>01</span>
        </div>
        <h3>
          Better
          <br />
          work.
          <br />
          <i>By design.</i>
        </h3>
        <div className="mbg-handbook-symbol">
          <span />
          <span />
          <span />
        </div>
        <div className="mbg-handbook-bottom">
          A CLEARER WAY FORWARD.<span>↗</span>
        </div>
      </div>
      <div className="mbg-handbook-page">
        <span>CONTENTS</span>
        <div>
          01 <b>Find your focus</b>
        </div>
        <div>
          02 <b>Build the habit</b>
        </div>
        <div>
          03 <b>Make it useful</b>
        </div>
        <div>
          04 <b>Keep improving</b>
        </div>
        <p>
          Space for ideas.
          <br />
          Structure for action.
        </p>
      </div>
    </div>
  );
}
function AtlasPreview() {
  return (
    <div className="mbg-atlas">
      <div className="mbg-mini-nav">
        <strong>ATLAS / WORKSHOP</strong>
        <span>CHAPTER ONE</span>
      </div>
      <div className="mbg-atlas-counter">01</div>
      <h3>
        A fresh
        <br />
        <i>perspective.</i>
      </h3>
      <div className="mbg-atlas-art">
        <span />
        <span />
        <span />
      </div>
      <div className="mbg-atlas-footer">
        <span>AN INVITATION TO THINK DIFFERENTLY.</span>
        <span>BEGIN →</span>
      </div>
    </div>
  );
}
const previews = {
  form: FormPreview,
  signal: SignalPreview,
  field: FieldPreview,
  solstice: SolsticePreview,
  handbook: HandbookPreview,
  atlas: AtlasPreview,
};

function PreviewFrame({ direction }: { direction: Direction }) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setScale(element.getBoundingClientRect().width / 360);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const Preview = previews[direction.id as keyof typeof previews];
  return (
    <div
      ref={frame}
      className={`mbg-preview mbg-preview-${direction.id}`}
      aria-hidden="true"
    >
      <div className="mbg-canvas" style={{ transform: `scale(${scale})` }}>
        <Preview />
      </div>
      <span className="mbg-card-action">
        <ArrowUpRight size={19} />
      </span>
    </div>
  );
}

export default function TemplateGallery({
  onChoose,
}: {
  onChoose?: (
    kind: Kind,
    brief: string,
    styleId: string,
    style?: Style,
  ) => void;
}) {
  const [filter, setFilter] = useState<Kind | "all">("all");
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
          Authored directions · {visible.length} previews
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
        These are style directions, not customer work. Your content and edits
        shape the finished project.
      </p>
    </section>
  );
}
