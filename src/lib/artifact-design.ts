type ArtifactKind = "website" | "book" | "presentation";

/** Append after the renderer's base CSS. Only authored IDs select rules;
 * unknown/custom styles keep the base composition and their chosen colours.
 * These rules never generate content or modify full-image visual slides. */
export function artifactDesignCss(styleId: string, kind: ArtifactKind): string {
  if (!Object.hasOwn(directions, styleId)) return "";
  const direction = directions[styleId];
  if (!direction) return "";
  return `${readability[kind]}${direction[kind]}${responsive[kind]}${kind === "presentation" ? statementGraphic(styleId) : ""}`;
}

/** Empty CSS-generated decoration is nonsemantic. Reserve its column rather
 * than placing artwork behind user text; compact screens stack it in flow. */
function statementGraphic(styleId: string): string {
  if (styleId !== "direction-signal" && styleId !== "direction-atlas")
    return "";
  const graphic =
    styleId === "direction-signal"
      ? `background:radial-gradient(circle closest-side,currentColor 0 15%,transparent 16% 39%,currentColor 40% 41%,transparent 42% 65%,currentColor 66% 67%,transparent 68% 91%,currentColor 92% 93%,transparent 94%);opacity:.72;`
      : `background:radial-gradient(circle at 34% 46%,currentColor 0 28%,transparent 28.5%),radial-gradient(circle at 66% 60%,currentColor 0 28%,transparent 28.5%);opacity:.16;`;
  return `
    .slide.slide-statement:not(.visual){padding-right:33%;position:relative}
    .slide.slide-statement:not(.visual)::after{content:"";position:absolute;right:6%;top:50%;transform:translateY(-50%);width:22%;aspect-ratio:1;pointer-events:none;color:var(--artifact-accent,currentColor);${graphic}}
    @media screen and (max-width:700px){
      .slide.slide-statement:not(.visual){padding-right:24px}
      .slide.slide-statement:not(.visual)::after{position:relative;display:block;right:auto;top:auto;transform:none;width:150px;max-width:60%;margin:32px 0 0 auto}
    }
    @media print{
      .slide.slide-statement:not(.visual){padding-right:4.25in}
      .slide.slide-statement:not(.visual)::after{right:.8in;width:2.7in;print-color-adjust:exact;-webkit-print-color-adjust:exact}
    }
  `;
}

const readability: Record<ArtifactKind, string> = {
  website: `
    .site-nav,.site-nav nav{flex-wrap:wrap}
    .site-nav>a,.site-nav nav a{overflow-wrap:anywhere}
    .site-nav nav a{display:inline-flex;align-items:center;min-height:44px}
    .site-hero>*,.site-section>*{min-width:0}
    .site-hero h1,.site-section h2{overflow-wrap:anywhere;text-wrap:balance}
    .site-hero p,.site-section p{max-width:68ch}
    .site-section{border-color:currentColor;border-color:color-mix(in srgb,currentColor 20%,transparent)}
    .site-nav{border-color:currentColor;border-color:color-mix(in srgb,currentColor 20%,transparent)}
    .site-section blockquote{max-width:38ch}
  `,
  book: `
    .cover,.contents,.book-body{min-width:0}
    .cover h1,.book-body h2,.contents li{overflow-wrap:anywhere}
    .book-body{line-height:1.8}
    .book-body p{max-width:68ch}
    .contents li{border-color:currentColor;border-color:color-mix(in srgb,currentColor 20%,transparent)}
    .cover h1{text-wrap:balance}
    .cover-art{flex-shrink:0}
    .book-body figure img{max-width:100%;height:auto}
  `,
  presentation: `
    .slide:not(.visual){height:auto;min-height:38vw;aspect-ratio:auto;overflow:visible}
    .slide:not(.visual) h2{overflow-wrap:anywhere;text-wrap:balance}
    .slide:not(.visual) .slide-body{min-width:0;flex-wrap:wrap}
    .slide:not(.visual) .slide-body p{flex:1 1 28ch;min-width:0;margin:0;max-width:62ch;overflow-wrap:anywhere}
    .slide:not(.visual) .slide-body img{flex:0 1 43%;min-width:0;height:auto;object-fit:contain}
    .slide:not(.visual) .slide-number{letter-spacing:.14em;font-variant-numeric:tabular-nums}
  `,
};

const directions: Record<string, Record<ArtifactKind, string>> = {
  "direction-form": {
    website: `
      .site-nav{padding:24px 7%}.site-nav>a{font-weight:400;letter-spacing:-.045em;font-size:26px}
      main,body>footer{max-width:1440px;padding-left:7%;padding-right:7%}
      .site-hero{grid-template-columns:1.25fr 1fr;gap:9%;padding:110px 0 100px;align-items:end}
      .site-hero h1{font-size:clamp(44px,6.8vw,96px);font-weight:400;line-height:1.03;max-width:12ch}
      .eyebrow{letter-spacing:.2em}.site-section{display:grid;grid-template-columns:1fr 2fr;gap:8%;padding:70px 0}
      .site-section h2{font-weight:400;font-size:clamp(27px,3vw,42px);margin:0}
    `,
    book: `
      .cover{gap:16mm;justify-content:center}.cover h1{font-weight:400;font-size:clamp(44px,7vw,76px);max-width:13ch}
      .cover-rule{width:100%;height:1px}.contents{padding:18mm 0}.book-body h2{font-weight:400;font-size:36px}
    `,
    presentation: `
      .slide:not(.visual){padding:7% 8%}.slide:not(.visual) h2{font-weight:400;font-size:clamp(34px,5vw,68px);max-width:18ch}
      .slide:not(.visual) .slide-number{padding-bottom:18px;border-bottom:1px solid currentColor;margin-bottom:45px}
      .slide:not(.visual) .slide-body{font-size:clamp(19px,2.1vw,27px);gap:8%}
    `,
  },
  "direction-signal": {
    website: `
      .site-nav>a{font-size:24px;letter-spacing:-.05em}.site-hero{padding:100px 0;grid-template-columns:1.4fr 1fr}
      .site-hero h1{font-size:clamp(48px,7.2vw,104px);line-height:.98;max-width:12ch;letter-spacing:-.06em}
      .eyebrow{letter-spacing:.13em}.site-section h2{font-size:clamp(30px,4.5vw,56px);max-width:20ch}
      .site-section>div{margin-left:auto;width:100%;max-width:800px}
    `,
    book: `
      .cover h1{font-size:clamp(46px,7vw,80px);line-height:1;letter-spacing:-.06em;max-width:14ch}
      .cover-rule{width:130px;height:5px}.contents h2{font-size:38px}.contents li{font-weight:600}
      .book-body h2{font-size:38px;letter-spacing:-.04em}.book-body blockquote{font-size:26px;font-weight:600}
    `,
    presentation: `
      .slide:not(.visual){padding:5% 7% 7%}.slide:not(.visual) h2{font-size:clamp(40px,6.8vw,88px);line-height:1.02;letter-spacing:-.055em;max-width:16ch;margin:38px 0}
      .slide:not(.visual) .slide-number{margin-bottom:24px;font-weight:700}
      .slide:not(.visual) .slide-body{font-size:clamp(20px,2.3vw,30px);line-height:1.55}
      .slide.slide-statement:not(.visual) h2{font-size:clamp(48px,8.2vw,112px);max-width:13ch;margin-top:7%}
    `,
  },
  "direction-field": {
    website: `
      .site-nav>a{font-weight:400;font-size:25px}.site-hero{padding:85px 0;grid-template-columns:1.1fr 1fr;gap:10%}
      .site-hero h1{font-weight:400;font-size:clamp(42px,6vw,84px);max-width:13ch;line-height:1.04}
      .site-section{display:grid;grid-template-columns:1fr 2.2fr;gap:8%}.site-section h2{font-weight:400;margin:0}
      .eyebrow{letter-spacing:.2em}.site-section p{line-height:1.85}
    `,
    book: `
      .cover{padding:18mm 0;gap:14mm;border-top:2px solid currentColor}.cover h1{font-weight:400;font-size:clamp(52px,8vw,90px);line-height:.98;max-width:10ch}
      .cover-rule{width:100%;height:1px}.contents h2{font-weight:400;font-size:35px}.contents ol{padding-left:24px}
      .contents li{padding:12px 0 12px 12px}.book-body h2{font-weight:400;font-size:36px;line-height:1.2}
      .book-body blockquote{font-style:italic;line-height:1.55}
    `,
    presentation: `
      .slide:not(.visual){padding:7% 8%;border-top:3px solid currentColor}.slide:not(.visual) h2{font-weight:400;font-size:clamp(36px,5.5vw,72px);max-width:16ch}
      .slide:not(.visual) .slide-body{font-size:clamp(20px,2.2vw,28px);line-height:1.7}.slide:not(.visual) .slide-number{margin-bottom:40px}
    `,
  },
  "direction-solstice": {
    website: `
      .site-nav>a{font-weight:400;font-size:30px;letter-spacing:-.05em}.site-hero{grid-template-columns:1.35fr 1fr;gap:7%;padding:95px 0}
      .site-hero h1{font-weight:400;font-size:clamp(48px,7.2vw,98px);max-width:12ch;line-height:1.02}
      .site-hero figure img{border-radius:100px 100px 12px 12px}.site-section{padding:80px 0}
      .site-section h2{font-weight:400;font-size:clamp(36px,4.5vw,58px);max-width:20ch}
      .site-section>div{max-width:860px}.eyebrow{letter-spacing:.12em}
    `,
    book: `
      .cover{padding:16mm 0;gap:15mm}.cover h1{font-weight:400;font-size:clamp(46px,7vw,78px);max-width:12ch;line-height:1.03}
      .cover-art{border-radius:50px 50px 0 0}.cover-rule{width:90px;height:3px}
      .contents h2,.book-body h2{font-weight:400;font-size:36px}.book-body blockquote{font-style:italic}
    `,
    presentation: `
      .slide:not(.visual){padding:6% 8%}.slide:not(.visual) h2{font-weight:400;font-size:clamp(38px,6vw,78px);max-width:17ch;line-height:1.07}
      .slide:not(.visual) .slide-body{font-size:clamp(20px,2.3vw,29px);gap:7%}.slide:not(.visual) .slide-body img{border-radius:36px 36px 0 0}
      .slide:not(.visual) .slide-number{border-bottom:1px solid currentColor;padding-bottom:16px;max-width:90px}
    `,
  },
  "direction-handbook": {
    website: `
      .site-nav>a{font-size:22px;letter-spacing:-.04em}.site-hero{grid-template-columns:1.2fr 1fr;gap:7%;padding:75px 0}
      .site-hero h1{font-size:clamp(40px,5.4vw,72px);max-width:16ch;line-height:1.08}
      .site-section{display:grid;grid-template-columns:1fr 2fr;gap:6%;padding:55px 0}.site-section h2{font-size:28px;margin:0}
      .eyebrow{font-weight:700;letter-spacing:.1em}.site-section p{line-height:1.8}
    `,
    book: `
      .cover{border-top:10px solid currentColor;padding-top:20mm;gap:14mm}.cover h1{font-size:clamp(42px,6vw,68px);max-width:15ch;line-height:1.08}
      .cover-rule{width:100%;height:2px}.contents h2{font-size:32px}.contents li{padding:14px 0;font-weight:600}
      .book-body h2{font-size:30px;line-height:1.25}.book-body blockquote{font-size:21px;line-height:1.7}
    `,
    presentation: `
      .slide:not(.visual){padding:6% 7%;border-top:8px solid currentColor}.slide:not(.visual) h2{font-size:clamp(34px,4.8vw,62px);max-width:22ch}
      .slide:not(.visual) .slide-body{font-size:clamp(20px,2.1vw,27px);line-height:1.7}.slide:not(.visual) .slide-number{font-weight:700;margin-bottom:32px}
    `,
  },
  "direction-atlas": {
    website: `
      .site-nav>a{font-weight:400;font-size:26px}.site-hero{padding:90px 0;gap:9%;grid-template-columns:1.2fr 1fr}
      .site-hero h1{font-weight:400;font-size:clamp(44px,6.3vw,86px);line-height:1.08;max-width:15ch}
      .site-section{padding:70px 0}.site-section h2{font-weight:400;font-size:clamp(32px,4vw,50px);max-width:24ch}
      .site-section>div{margin-left:12%;max-width:760px}.eyebrow{letter-spacing:.18em}
    `,
    book: `
      .cover{gap:18mm;padding-top:18mm}.cover h1{font-weight:400;font-size:clamp(46px,7vw,78px);max-width:14ch;line-height:1.1}
      .cover-rule{width:120px;height:1px}.contents h2,.book-body h2{font-weight:400;font-size:36px}
      .contents li{padding:13px 0}.book-body blockquote{font-style:italic;font-size:24px;line-height:1.6}
    `,
    presentation: `
      .slide:not(.visual){padding:6% 8% 8%}.slide:not(.visual) h2{font-weight:400;font-size:clamp(38px,5.8vw,76px);max-width:20ch;line-height:1.1}
      .slide:not(.visual) .slide-number{padding-bottom:18px;border-bottom:1px solid currentColor;margin-bottom:36px}
      .slide:not(.visual) .slide-body{font-size:clamp(20px,2.2vw,28px);line-height:1.7;gap:8%}
      .slide.slide-statement:not(.visual) h2{font-size:clamp(44px,7.5vw,98px);max-width:16ch;margin-top:7%}
    `,
  },
};

const responsive: Record<ArtifactKind, string> = {
  website: `
    @media(max-width:700px){
      .site-nav{align-items:flex-start;gap:12px;padding:18px 6%}.site-nav nav{display:flex;gap:4px 18px;width:100%}
      .site-hero{grid-template-columns:1fr;gap:32px;padding:52px 0}.site-hero h1{font-size:clamp(38px,10vw,64px);max-width:100%}
      .site-section{display:block;padding:42px 0}.site-section h2{margin:0 0 24px}.site-section>div{margin-left:0}
    }
    @media print{
      .site-nav nav{display:flex;flex-wrap:wrap}.site-nav nav a{min-height:0}.site-nav{padding:8mm 0}
      main,body>footer{max-width:none;padding-left:0;padding-right:0}.site-hero{display:block;padding:12mm 0}
      .site-hero h1{font-size:40pt;max-width:none}.site-hero figure{margin-top:8mm}
      .site-section{display:block;padding:8mm 0}.site-section h2{font-size:24pt;margin:0 0 5mm}
      .site-section>div{margin-left:0;max-width:none}html{scroll-behavior:auto}
    }
  `,
  book: `
    @media(max-width:600px){body{padding:24px}.cover{min-height:70vh;padding:28px 0;gap:32px}
      .cover h1{font-size:clamp(38px,11vw,64px);max-width:100%}.cover-art{height:auto;max-height:65vh}
      .contents{padding:38px 0}.book-body h2{font-size:30px}}
    @media print{body{padding:0;max-width:none}.cover{min-height:235mm;padding-top:12mm;gap:10mm}
      .cover h1{font-size:42pt;max-width:100%}.cover-art{height:auto;max-height:130mm}
      .contents{padding:12mm 0}.book-body h2{font-size:24pt;max-width:none}
      .book-body p{max-width:none}.book-body blockquote{font-size:16pt}html{scroll-behavior:auto}}
  `,
  presentation: `
    @media(max-width:700px){.slide:not(.visual){padding:38px 24px;min-height:80vh}
      .slide:not(.visual) h2{font-size:clamp(32px,8vw,48px);max-width:100%;margin:24px 0}
      .slide.slide-statement:not(.visual) h2{font-size:clamp(38px,10vw,58px);max-width:100%;margin-top:32px}
      .slide:not(.visual) .slide-body{display:flex;flex-direction:column;gap:24px;font-size:20px}
      .slide:not(.visual) .slide-body p{flex:auto}.slide:not(.visual) .slide-body img{flex:auto;width:100%;max-height:none}}
    @media print{.slide:not(.visual){width:13.333in;height:7.5in;min-height:0;aspect-ratio:auto;overflow:hidden;padding:.55in .8in}
      .slide:not(.visual) h2{font-size:36pt;max-width:100%;margin:.25in 0}
      .slide.slide-statement:not(.visual) h2{font-size:48pt;max-width:18ch;margin-top:.45in}
      .slide:not(.visual) .slide-body{font-size:20pt;line-height:1.5}
      .slide:not(.visual) .slide-number{margin-bottom:.2in;padding-bottom:.12in}
      .slide:not(.visual) .slide-body img{max-height:4in}.slide:not(.visual):last-child{break-after:auto}
      html{scroll-behavior:auto}}
  `,
};
