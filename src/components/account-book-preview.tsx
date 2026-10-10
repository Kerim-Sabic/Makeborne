"use client";
import {useCallback, useEffect, useRef, useState, type ReactNode} from "react";
import {ChevronLeft, ChevronRight} from "lucide-react";
import type {ArtifactContent} from "@/lib/domain";
import {BOOK_PAGE} from "@/lib/book-layout";

type Block = ArtifactContent["sections"][number]["blocks"][number];
export default function AccountBookPreview({title, blocks, renderBlock}: {title: string; blocks: Block[]; renderBlock: (block: Block) => ReactNode}) {
  const [index, setIndex] = useState(0);
  const [bodyPages, setBodyPages] = useState(1);
  const viewport = useRef<HTMLDivElement>(null), flow = useRef<HTMLDivElement>(null);
  const coverArt = blocks[0]?.type === "image" ? blocks[0] : undefined;
  const body = coverArt ? blocks.slice(1) : blocks;
  const current = Math.min(index, bodyPages), count = bodyPages + 1;
  const measure = useCallback(() => {
    if (!viewport.current || !flow.current) return;
    const width = viewport.current.getBoundingClientRect().width;
    if (!width) return;
    // CSS columns use fractional widths; clientWidth rounds and can invent a blank page.
    const pages = Math.max(1, Math.ceil((flow.current.scrollWidth - 0.5) / width));
    setBodyPages(previous => previous === pages ? previous : pages);
  }, []);
  useEffect(() => {
    const node = viewport.current, content = flow.current;
    if (!node || !content) return;
    let active = true;
    const update = () => {if (active) measure();};
    const resize = new ResizeObserver(update), mutation = new MutationObserver(update);
    resize.observe(node); mutation.observe(content, {childList: true, subtree: true, characterData: true});
    void document.fonts.ready.then(update); update();
    return () => {active = false; resize.disconnect(); mutation.disconnect();};
  }, [measure]);
  return <div className="ap-book-reader">
    <div className="ap-book-page ap-document" style={{aspectRatio: `${BOOK_PAGE.widthInches}/${BOOK_PAGE.heightInches}`}} aria-label={current === 0 ? "Book cover" : `Book reading page ${current}`}>
      {current === 0 && <header className="ap-book-cover ap-book-reader-cover"><span className="ap-cover-rule" /><h2>{title}</h2>{coverArt && <div className="ap-book-cover-art">{renderBlock(coverArt)}</div>}<span className="ap-cover-rule" /></header>}
      <div className="ap-book-page-viewport" ref={viewport} style={{visibility: current === 0 ? "hidden" : "visible"}} aria-hidden={current === 0} inert={current === 0} onLoadCapture={measure}>
        <div className="ap-book-flow" ref={flow} style={{transform: `translateX(-${Math.max(0, current - 1) * 100}%)`}}>
          {body.map(block => <div className={`ap-book-block ap-book-block-${block.type}`} key={block.id}>{renderBlock(block)}</div>)}
          {!body.length && <p>Add your first chapter to begin.</p>}
        </div>
      </div>
      {current > 0 && <span className="ap-book-folio" aria-hidden="true">{current}</span>}
    </div>
    <nav className="ap-book-navigation" aria-label="Book pages"><button type="button" aria-label="Previous book page" disabled={current === 0} onClick={() => setIndex(current - 1)}><ChevronLeft size={16} /></button><span aria-live="polite">{current === 0 ? "Cover" : `Page ${current} of ${bodyPages}`}</span><button type="button" aria-label="Next book page" disabled={current >= count - 1} onClick={() => setIndex(current + 1)}><ChevronRight size={16} /></button></nav>
    <p className="ap-book-format">6 × 9 in · Reading preview. PDF pagination may differ; EPUB adapts to the reader’s screen.</p>
  </div>;
}
