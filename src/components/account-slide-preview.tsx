"use client";
import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from "react";
import {slideBoxPercent} from "@/lib/presentations/composition";
import {presentationScene} from "@/lib/presentations/render-scene";
import {NATIVE_SLIDE_CSS} from "@/lib/presentations/native-css";
import type {previewSlides} from "@/lib/cloud/preview-content";

type Slide = ReturnType<typeof previewSlides>[number];
export default function AccountSlidePreview({slide, index, total, renderImage}: {slide: Slide; index: number; total: number; renderImage: (block: Slide["blocks"][number]) => ReactNode}) {
  const body = slide.blocks.map(block => block.text).filter(Boolean).join("\n\n");
  const composition = presentationScene(slide, index, total);
  const canvas = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState(false);
  const unsupported = slide.blocks.some(block => !["paragraph", "quote", "image"].includes(block.type) || (!!block.assetId && block.type !== "image"));
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      setOverflow([...node.querySelectorAll<HTMLElement>(".ap-native-text")].some(element => element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node); void document.fonts.ready.then(measure); measure();
    return () => {active = false; observer.disconnect();};
  }, [slide, index, total]);
  return <>
    <style>{NATIVE_SLIDE_CSS}</style>
    <article ref={canvas} className={`ap-native-slide ap-native-${composition.layout}`} style={{"--native-paper":composition.background??"var(--ap-canvas)","--native-ink":"var(--ap-ink)","--native-accent":"var(--ap-accent)","--native-heading":"var(--ap-heading)"} as CSSProperties} aria-label={`Slide ${index + 1} of ${total}`}>
      {composition.elements.map(element => {
        if(element.kind==='image'){
          const image=slide.blocks.find(block=>block.id===element.blockId);
          return image&&<div key={element.id} className="ap-native-image" style={{...slideBoxPercent(element),"--native-image-fit":element.fit} as CSSProperties}>{renderImage({...image,text:""})}</div>;
        }
        const style = {...slideBoxPercent(element), fontSize: `${element.fontSize / 12.8}cqw`, lineHeight: element.lineHeight,fontFamily:element.font==='heading'?'var(--native-heading)':'Arial,sans-serif',fontWeight:element.weight==='bold'?700:400,textAlign:element.align,...(element.color?{color:element.color}:{})} as CSSProperties;
        return element.role === "title" ? <h3 className="ap-native-text ap-native-title" style={style} key={element.id}>{element.text}</h3> : <p className={`ap-native-text ap-native-${element.role}`} style={style} key={element.id}>{element.text}</p>;
      })}
    </article>
    {(overflow || unsupported) && <div className="ap-slide-fit-warning" role="status"><strong>{unsupported ? "This slide includes content that needs a supported slide element." : "This slide has more text than fits."}</strong><p>{unsupported ? "Structured content is shown as text here; export will not silently discard it." : "Split or edit the content before exporting. Your full text is preserved below."}</p><details><summary>Read full slide text</summary><h4>{slide.title}</h4><p>{body}</p></details></div>}
  </>;
}
