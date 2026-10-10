import {z} from "zod";
import {SLIDE_CANVAS} from "./composition";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const box = {x:z.number().finite().min(0).max(SLIDE_CANVAS.width),y:z.number().finite().min(0).max(SLIDE_CANVAS.height),width:z.number().finite().positive().max(SLIDE_CANVAS.width),height:z.number().finite().positive().max(SLIDE_CANVAS.height)};
const source = z.discriminatedUnion("kind",[
  z.object({kind:z.literal("title")}).strict(),
  z.object({kind:z.literal("block"),blockId:z.string().uuid()}).strict(),
]);
const textElement = z.object({id:z.string().uuid(),kind:z.literal("text"),source,...box,fontSize:z.number().finite().min(24).max(144),lineHeight:z.number().finite().min(1).max(1.8),font:z.enum(["heading","body"]),weight:z.enum(["regular","bold"]),align:z.enum(["left","center","right"]),color:color.optional()}).strict();
const imageElement = z.object({id:z.string().uuid(),kind:z.literal("image"),blockId:z.string().uuid(),...box,fit:z.enum(["contain","cover"])}).strict();
/** Geometry references canonical content; it never embeds replacement copy, URLs or executable markup. */
export const SlideDesignSchema = z.object({schemaVersion:z.literal(1),background:color.optional(),elements:z.array(z.discriminatedUnion("kind",[textElement,imageElement])).min(1).max(40)}).strict().superRefine((design,ctx)=>{
  const ids=new Set<string>();
  for(const [index,element] of design.elements.entries()){
    if(ids.has(element.id))ctx.addIssue({code:"custom",path:["elements",index,"id"],message:"Slide element IDs must be unique."});
    ids.add(element.id);
    if(element.x+element.width>SLIDE_CANVAS.width||element.y+element.height>SLIDE_CANVAS.height)ctx.addIssue({code:"custom",path:["elements",index],message:"Slide elements must stay within the 1280 × 720 canvas."});
  }
});
export type SlideDesign = z.infer<typeof SlideDesignSchema>;
type SlideSource = {title:string;blocks:readonly {id:string;type:string;text:string;assetId?:string|null}[]};
/** Every supplied word/caption/image is represented exactly once. No inferred summarization. */
export function slideDesignSourceIssues(design:SlideDesign,source:SlideSource):string[]{
  const issues:string[]=[],textReferences=new Map<string,number>(),imageReferences=new Map<string,number>();
  const blocks=new Map(source.blocks.map(block=>[block.id,block]));
  for(const element of design.elements){
    if(element.kind==='text'){
      const key=element.source.kind==='title'?'title':element.source.blockId;
      textReferences.set(key,(textReferences.get(key)??0)+1);
      const block=element.source.kind==='block'?blocks.get(element.source.blockId):undefined;
      if(element.source.kind==='block'&&(!block||!['paragraph','quote','image'].includes(block.type)))issues.push('A text element must reference a paragraph, quote or image caption on this slide.');
    }else{
      imageReferences.set(element.blockId,(imageReferences.get(element.blockId)??0)+1);
      const block=blocks.get(element.blockId);
      if(!block||block.type!=='image'||!block.assetId)issues.push('An image element must reference approved artwork on this slide.');
    }
  }
  if((textReferences.get('title')??0)!==1)issues.push('The slide title must have exactly one text element.');
  for(const block of source.blocks){
    if(!['paragraph','quote','image'].includes(block.type))issues.push('This structured block needs a native slide element before custom composition is available.');
    const textCount=textReferences.get(block.id)??0;
    if((block.type!=='image'||!!block.text)&&textCount!==1)issues.push('Every supplied text block and image caption must appear exactly once.');
    if(block.type==='image'&&(imageReferences.get(block.id)??0)!==1)issues.push('Every supplied image must appear exactly once.');
  }
  for(const count of textReferences.values())if(count>1)issues.push('Text cannot be duplicated across slide elements.');
  for(const count of imageReferences.values())if(count>1)issues.push('Artwork cannot be duplicated across slide elements.');
  return [...new Set(issues)];
}
export function resolveSlideDesign(designInput:unknown,source:SlideSource){
  const design=SlideDesignSchema.parse(designInput),issues=slideDesignSourceIssues(design,source);
  if(issues.length)throw new Error(issues.join(' '));
  const blocks=new Map(source.blocks.map(block=>[block.id,block]));
  return {...design,elements:design.elements.map(element=>element.kind==='text'?{...element,text:element.source.kind==='title'?source.title:blocks.get(element.source.blockId)!.text}:{...element,assetId:blocks.get(element.blockId)!.assetId!})};
}
