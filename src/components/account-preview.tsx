"use client";
import { useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Image as ImageIcon, Monitor, Smartphone } from "lucide-react";
import type { ArtifactContent, StyleProfile } from "@/lib/domain";
import { previewBlocks, previewSlides } from "@/lib/cloud/preview-content";
import "@/app/account-preview.css";
import WebsitePreview from "./website-preview";
import AccountArtwork, { type ArtworkScope } from "./account-artwork";

const fonts: Record<string, string> = {
  "Source Serif 4": 'var(--font-serif), Georgia, serif',
  Georgia: "Georgia, serif", Inter: 'var(--font-inter), Arial, sans-serif', Arial: "Arial, sans-serif",
};
type Block = ArtifactContent["sections"][number]["blocks"][number];
function PreviewBlock({ block, artworkScope }: { block: Block; artworkScope?: ArtworkScope }) {
  if (block.assetId && artworkScope) return <AccountArtwork key={`${artworkScope.accountId}:${artworkScope.artifactId}:${block.assetId}`} scope={artworkScope} assetId={block.assetId} caption={block.text} />;
  if (block.assetId || block.type === "image") return <figure className="ap-placeholder"><ImageIcon size={24} /><figcaption>{block.text || "Artwork"}</figcaption><small>Artwork preview unavailable</small></figure>;
  if (block.type === "heading") return <h3>{block.text}</h3>;
  if (block.type === "quote") return <blockquote>{block.text}</blockquote>;
  if (block.type === "paragraph") return <p>{block.text}</p>;
  if (block.type === "callout") return <div className="ap-callout">{block.text}</div>;
  return <div className="ap-structured"><small>{block.type} · text preview</small><p>{block.text || "No text supplied"}</p></div>;
}

export default function AccountPreview({ content, style, dirty, artworkScope }: { content: ArtifactContent; style: StyleProfile; dirty: boolean; artworkScope?: ArtworkScope }) {
  const [mobile, setMobile] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const slides = content.kind === "presentation" ? previewSlides(content) : [];
  const current = Math.min(slideIndex, Math.max(0, slides.length - 1));
  const palette = {
    "--ap-canvas": style.colors.canvas ?? "#F8F7F4", "--ap-ink": style.colors.ink ?? "#16181D", "--ap-accent": style.colors.accent ?? "#7862A7",
    "--ap-heading": fonts[style.typography.headingFont] ?? "Georgia, serif", "--ap-body": fonts[style.typography.bodyFont] ?? "Arial, sans-serif",
  } as CSSProperties;
  if(content.kind === "website" && content.website) return <WebsitePreview title={content.title} website={content.website} dirty={dirty} />;
  return <section className="account-preview" aria-label="Project layout preview">
    <header className="ap-toolbar"><div><strong>Preview</strong><small>{dirty ? "Current edits" : "Current content"} · {style.name}</small></div>
      {content.kind === "website" && <div className="ap-devices" aria-label="Preview width"><button type="button" aria-label="Desktop preview" aria-pressed={!mobile} onClick={() => setMobile(false)}><Monitor size={16} /></button><button type="button" aria-label="Mobile preview" aria-pressed={mobile} onClick={() => setMobile(true)}><Smartphone size={16} /></button></div>}
    </header>
    <div className={`ap-stage ${content.kind}${mobile && content.kind === "website" ? " ap-mobile" : ""}`} style={palette}>
      {content.kind === "presentation" ? <>
        <article className="ap-slide" aria-label={`Slide ${current + 1} of ${slides.length}`}><span className="ap-slide-number">{String(current + 1).padStart(2, "0")}</span><h3>{slides[current].title}</h3>{slides[current].blocks.map(block => <PreviewBlock key={block.id} block={block} artworkScope={artworkScope} />)}</article>
        <nav className="ap-slide-nav" aria-label="Preview slides"><button type="button" disabled={current === 0} aria-label="Previous slide" onClick={() => setSlideIndex(current - 1)}><ChevronLeft size={16} /></button><span aria-live="polite">{current + 1} / {slides.length}</span><button type="button" disabled={current === slides.length - 1} aria-label="Next slide" onClick={() => setSlideIndex(current + 1)}><ChevronRight size={16} /></button></nav>
      </> : <div className="ap-document">
        {content.kind === "book" ? <header className="ap-book-cover"><span className="ap-cover-rule" /><h2>{content.title}</h2><span className="ap-cover-rule" /></header> : <header className="ap-site-brand">{content.title}<span className="ap-brand-dot" /></header>}
        <div className="ap-reading">{previewBlocks(content).map(block => <PreviewBlock key={block.id} block={block} artworkScope={artworkScope} />)}{!content.sections.some(section => section.blocks.length) && <p>Add content to begin shaping your {content.kind}.</p>}</div>
      </div>}
    </div>
    <p className="ap-note">Layout preview of your current content. Exported pagination and line breaks may differ. This does not publish your project.</p>
  </section>;
}
