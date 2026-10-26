"use client";
import { useEffect, useState } from "react";
import "@/app/composer-controls.css";
import { ART_QUALITIES, ART_QUALITY_TEXT, ART_QUALITY_TOPIC, BOOK_SHAPES, BOOK_SHAPE_SPECS, BOOK_SHAPE_TOPIC, DECK_ASPECTS, DECK_ASPECT_SPECS, DECK_ASPECT_TOPIC, artQualityFromBrief, bookShapeFromBrief, deckAspectFromBrief, parseDocumentImageOffers,
  type ArtOffer, type ArtQuality, type BookShape, type DeckAspect, type DocumentImageOffers, type ImageOptions } from "@/lib/documents/art-formats";
import type { DocumentSource } from "@/lib/documents/schema";

/** The client's image choices for a presentation or a book (owner, Kerim, 26 Oct 2026: "add quality button and aspect
 * ratio so user can choose"): the slide or page shape and the image quality, in plain words, with what each costs per
 * generated slide or page shown before anything is generated. Choices with no measured image size are shown but
 * disabled ("not available yet"); the image model is chosen automatically and never named. */
export type DocumentKind = "presentation" | "book";
export type ImageChoice = { quality: ArtQuality; shape: DeckAspect | BookShape };

const offersFor = (offers: DocumentImageOffers | null, kind: DocumentKind, shape: string): ArtOffer[] | null =>
  !offers ? null : kind === "presentation" ? offers.presentation[shape as DeckAspect] ?? null : offers.book[shape as BookShape]?.page ?? null;
const available = (list: ArtOffer[] | null, quality: ArtQuality) => list ? Boolean(list.find(offer => offer.quality === quality)?.available) : true;

/** The choice a composer starts from: the saved document's, else the brief's own words or answers, else 16:9 or 6 x 9 at
 * High when it can render, else Standard. A saved choice that cannot render shows as the next lower quality. */
export function initialImageChoice(kind: DocumentKind, offers: DocumentImageOffers | null, brief = "", doc?: DocumentSource | null): ImageChoice {
  const shape = kind === "presentation"
    ? (doc?.kind === "deck" ? doc.art?.aspect : undefined) ?? (doc ? "16:9" : deckAspectFromBrief(brief) ?? "16:9")
    : (doc?.kind === "book" ? doc.shape : undefined) ?? (doc ? "portrait" : bookShapeFromBrief(brief) ?? "portrait");
  const saved = doc?.kind === "deck" ? doc.art?.quality ?? (doc.art ? "standard" : undefined) : doc?.kind === "book" ? doc.art?.quality ?? (doc.art ? "standard" : undefined) : undefined;
  const list = offersFor(offers, kind, shape);
  const wanted = saved ?? artQualityFromBrief(brief) ?? (available(list, "high") ? "high" : "standard");
  const quality = ART_QUALITIES.slice(0, ART_QUALITIES.indexOf(wanted) + 1).reverse().find(candidate => available(list, candidate)) ?? "standard";
  return { quality, shape };
}
/** What the build request carries. */
export const imageOptionsOf = (kind: DocumentKind, choice: ImageChoice): ImageOptions =>
  kind === "presentation" ? { quality: choice.quality, aspect: choice.shape as DeckAspect } : { quality: choice.quality, shape: choice.shape as BookShape };
/** The choice as answer lines in a new project's brief (read back on the first build by creation-options/art-formats). */
export function imageChoiceLines(kind: DocumentKind, choice: ImageChoice) {
  const shape = kind === "presentation" ? DECK_ASPECT_SPECS[choice.shape as DeckAspect].label : BOOK_SHAPE_SPECS[choice.shape as BookShape].label;
  return `- ${kind === "presentation" ? DECK_ASPECT_TOPIC : BOOK_SHAPE_TOPIC}: ${shape}\n- ${ART_QUALITY_TOPIC}: ${ART_QUALITY_TEXT[choice.quality].label}`;
}
/** "about 2 credits per slide (at most 5)", or why it is unavailable. */
export function creditImpact(kind: DocumentKind, offers: DocumentImageOffers | null, choice: ImageChoice) {
  const offer = offersFor(offers, kind, choice.shape)?.find(item => item.quality === choice.quality);
  const unit = kind === "presentation" ? "generated slide" : "generated page";
  if (!offers) return "";
  if (!offer?.available || !offer.perImage) return `${ART_QUALITY_TEXT[choice.quality].label} is not available for this shape yet.`;
  return `${ART_QUALITY_TEXT[choice.quality].label} images: about ${offer.perImage.expected} credit${offer.perImage.expected === 1 ? "" : "s"} per ${unit} (at most ${offer.perImage.max} with a retry), inside this request's limit.`;
}

/** The offers from GET /api/build (credits per image at the live rate); null until loaded, or while images can't be made
 * now (features.documentImages false: no image model or OpenAI spending closed), so no image controls are shown. */
export function useDocumentImageOffers(enabled = true) {
  const [offers, setOffers] = useState<DocumentImageOffers | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    fetch("/api/build", { cache: "no-store" }).then(response => response.json()).then(value => { if (current) setOffers(value?.features?.documentImages === true ? parseDocumentImageOffers(value?.documentImages) : null); }).catch(() => undefined);
    return () => { current = false; };
  }, [enabled]);
  return offers;
}

export default function DocumentImageControls({ kind, value, onChange, offers, disabled = false, className = "" }: {
  kind: DocumentKind; value: ImageChoice; onChange: (next: ImageChoice) => void; offers: DocumentImageOffers | null; disabled?: boolean; className?: string;
}) {
  const shapes = kind === "presentation" ? DECK_ASPECTS.map(id => ({ id, label: DECK_ASPECT_SPECS[id].label, hint: DECK_ASPECT_SPECS[id].hint }))
    : BOOK_SHAPES.map(id => ({ id, label: BOOK_SHAPE_SPECS[id].label, hint: BOOK_SHAPE_SPECS[id].hint }));
  const list = offersFor(offers, kind, value.shape);
  const pickShape = (shape: string) => {
    const next = offersFor(offers, kind, shape);
    // Keep the quality if the new shape can render it; otherwise the next lower one that can.
    const quality = ART_QUALITIES.slice(0, ART_QUALITIES.indexOf(value.quality) + 1).reverse().find(candidate => available(next, candidate)) ?? "standard";
    onChange({ shape: shape as ImageChoice["shape"], quality });
  };
  const shapeLabel = kind === "presentation" ? "Slide shape" : "Page shape";
  return <span className={`doc-image-controls ${className}`.trim()}>
    <select aria-label={shapeLabel} title={`${shapeLabel}: ${shapes.find(shape => shape.id === value.shape)?.hint ?? ""}`} value={value.shape} disabled={disabled} onChange={event => pickShape(event.target.value)}>
      {shapes.map(shape => <option key={shape.id} value={shape.id}>{shape.label}</option>)}
    </select>
    <select aria-label="Image quality" title={ART_QUALITY_TEXT[value.quality].hint} value={value.quality} disabled={disabled} onChange={event => onChange({ ...value, quality: event.target.value as ArtQuality })}>
      {ART_QUALITIES.map(quality => {
        const offer = list?.find(item => item.quality === quality), ok = available(list, quality);
        return <option key={quality} value={quality} disabled={!ok}>{ART_QUALITY_TEXT[quality].label}{!ok ? " (not available yet)" : offer?.perImage ? ` · ~${offer.perImage.expected} cr` : ""}</option>;
      })}
    </select>
  </span>;
}
