import sanitizeHtml from 'sanitize-html';
import { WebsiteDesignSchema, type WebsiteDesign } from './website-contract';
const escape = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export function cleanWebsite(input: WebsiteDesign): WebsiteDesign {
 const website=WebsiteDesignSchema.parse(input);
 const html=sanitizeHtml(website.html,{
  allowedTags:['header','nav','main','section','article','aside','footer','div','span','h1','h2','h3','h4','p','a','ul','ol','li','details','summary','figure','figcaption','strong','em','small','br','hr','blockquote','table','thead','tbody','tr','th','td'],
  allowedAttributes:{'*':['class','id','aria-label','aria-hidden'],a:['href'],details:['open'],th:['scope']},
  transformTags:{a:(_tag,attrs)=>({tagName:'a',attribs:{...attrs,href:/^#[a-zA-Z][\w-]*$/.test(attrs.href??'')?attrs.href:'#'}})},
 });
 // CSS stays isolated in a sandbox; resource loads are denied by the document CSP.
 const css=website.css.replace(/</g,'').replace(/@import[^;]*;?/gi,'');
 if(!/<h1[\s>]/i.test(html)||!/<main[\s>]/i.test(html))throw new Error('Website needs a main landmark and a primary heading.');
 const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
 for(const link of html.matchAll(/\bhref="#([^"]*)"/g)){if(link[1]&&!ids.has(link[1]))throw new Error('Website navigation contains a missing destination.');}
 return {...website,html,css};
}

export function websiteDocument(title:string, input:WebsiteDesign, preview=false) {
 const site=cleanWebsite(input);
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'"><meta name="referrer" content="no-referrer"><title>${escape(title)}</title><meta name="description" content="${escape(site.description)}"><style>*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;overflow-wrap:break-word}img{max-width:100%}${site.css}\n@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}:focus-visible{outline:3px solid currentColor;outline-offset:4px}</style></head><body>${preview ? site.html.replaceAll('href="#','href="about:srcdoc#') : site.html}</body></html>`;
}
