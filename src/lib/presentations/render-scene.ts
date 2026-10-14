import {composeNativeSlide,type SlideBox} from "./composition";
import {resolveSlideDesign,type SlideDesign} from "./slide-design";
type SceneBlock={id:string;type:string;text:string;assetId?:string|null};
export type SceneText=SlideBox&{id:string;kind:"text";role:"title"|"body"|"folio";text:string;fontSize:number;lineHeight:number;font:"heading"|"body";weight:"regular"|"bold";align:"left"|"center"|"right";color?:string};
export type SceneImage=SlideBox&{id:string;kind:"image";blockId:string;fit:"contain"|"cover"};
export type PresentationScene={layout:string;background?:string;elements:(SceneText|SceneImage)[]};
/** One resolved representation for both legacy fallback and saved custom geometry. */
export function presentationScene(source:{title:string;blocks:readonly SceneBlock[];design?:SlideDesign},index:number,total:number):PresentationScene{
  if(source.design){
    const resolved=resolveSlideDesign(source.design,source);
    return {layout:"custom",background:resolved.background,elements:resolved.elements.map(element=>element.kind==="text"?{...element,role:element.source.kind==="title"?"title":"body"}:element)};
  }
  const image=source.blocks.find(block=>block.type==='image');
  const composition=composeNativeSlide({title:source.title,body:source.blocks.map(block=>block.text).filter(Boolean).join('\n\n'),hasImage:!!image},index,total);
  return {layout:composition.layout,elements:[...composition.text.map((element):SceneText=>({...element,id:element.kind,kind:"text",role:element.kind,font:element.kind==='title'?'heading':'body',weight:'regular',align:element.kind==='folio'?'right':'left'})),...(composition.image&&image?[{...composition.image,id:'artwork',kind:'image' as const,blockId:image.id,fit:'contain' as const}]:[])]};
}
