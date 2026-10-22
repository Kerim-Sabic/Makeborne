import type { Deck, Slide } from "./schema";
import { slideCoverScene } from "./cover-composition";
import { COMPOSITIONS, type CompositionId } from "./composition-catalog";
import { directionOf } from "./directions";
import { hash, metrics, toneColors, type Ctx, type SlideScene } from "./scene-kit";
import * as T from "./compose-title";
import * as C from "./compose-content";
import * as M from "./compose-media";
import { placeImage, placementsFor } from "./compose-image";
import type { ImagePlacement } from "./schema";

/** Every deck slide is composed once into absolute primitives on a 1280×720
 * canvas by its art direction. The HTML preview/PDF and the editable PPTX both
 * draw these same primitives, so what the user approves is what they export.
 *
 * Each layout has several art-directed compositions. The planner picks one per
 * slide deterministically: the direction's preferences, rotated by a per-deck
 * seed, never the same composition twice in a row, no two colour fields back to
 * back, and only compositions whose copy fits without overflow. */
export { W, H, glyphUnits, estimateLines, textHeight, fitSize, toneColors } from "./scene-kit";
export type { Prim, TextPrim, RectPrim, EllipsePrim, LinePrim, PathPrim, PathSeg, ArtPrim, ImagePrim, ChartPrim, ChartColors, ChartStyle, SlideScene, ImageTreatment } from "./scene-kit";

type Kind = "field" | "airy" | "dense";
type Composition = { kind: Kind; accepts?: (slide: Slide, ctx: Ctx) => boolean; draw: (ctx: Ctx, slide: Slide) => void };
const n = (slide: Slide) => slide.points?.length ?? 0;
const stats = (slide: Slide) => slide.stats?.length ?? 0;
const flow = (slide: Slide) => slide.diagram?.kind === "process" || slide.diagram?.kind === "timeline";

const REGISTRY: Record<CompositionId, Composition> = {
  "cover-poster": { kind: "airy", draw: (ctx, s) => T.coverPoster(ctx, s) },
  "cover-split": { kind: "field", draw: (ctx, s) => T.coverSplit(ctx, s) },
  "cover-centered": { kind: "airy", draw: (ctx, s) => T.coverCentered(ctx, s) },
  "cover-masthead": { kind: "airy", draw: T.coverMasthead },
  "cover-modules": { kind: "airy", draw: T.coverModules },
  "cover-glow": { kind: "field", draw: (ctx, s) => T.coverGlow(ctx, s) },
  "cover-boxed": { kind: "airy", draw: (ctx, s) => T.coverBoxed(ctx, s) },
  "cover-arch": { kind: "field", draw: (ctx, s) => T.coverArch(ctx, s) },
  "cover-image": { kind: "field", accepts: s => !!s.image, draw: (ctx, s) => T.coverImage(ctx, s) },
  "closing-ask": { kind: "airy", draw: T.closingAsk },
  "closing-field": { kind: "field", draw: T.closingField },
  "closing-centered": { kind: "airy", draw: (ctx, s) => T.coverCentered(ctx, s, true) },
  "closing-split": { kind: "field", draw: T.closingSplit },
  "closing-boxed": { kind: "airy", draw: T.closingBoxed },
  "closing-next": { kind: "dense", accepts: s => (s.points?.length ?? 0) >= 1, draw: T.closingNext },
  "section-numeral": { kind: "airy", draw: T.sectionNumeral },
  "section-field": { kind: "field", draw: T.sectionField },
  "section-split": { kind: "field", draw: T.sectionSplit },
  "section-centered": { kind: "airy", draw: T.sectionCentered },
  "section-index": { kind: "airy", accepts: (_, ctx) => ctx.sections.length >= 2, draw: T.sectionIndex },
  "statement-hero": { kind: "airy", draw: T.statementHero },
  "statement-hanging": { kind: "airy", draw: T.statementHanging },
  "statement-centered": { kind: "airy", draw: T.statementCentered },
  "statement-field": { kind: "field", draw: T.statementField },
  "statement-split": { kind: "field", draw: T.statementSplit },
  "points-columns": { kind: "dense", accepts: s => n(s) <= 4, draw: C.pointsColumns },
  "points-rows": { kind: "dense", draw: C.pointsRows },
  "points-cards": { kind: "dense", accepts: s => n(s) <= 4, draw: C.pointsCards },
  "points-feature": { kind: "dense", accepts: s => n(s) >= 3 && n(s) <= 5, draw: C.pointsFeature },
  "points-grid": { kind: "dense", accepts: s => n(s) >= 3, draw: C.pointsGrid },
  "agenda-list": { kind: "dense", draw: C.agendaList },
  "agenda-columns": { kind: "dense", accepts: s => n(s) <= 4, draw: C.agendaColumns },
  "stats-hero": { kind: "airy", accepts: s => stats(s) <= 2, draw: C.statsHero },
  "stats-row": { kind: "dense", draw: C.statsRow },
  "stats-tiles": { kind: "dense", accepts: s => stats(s) >= 2, draw: C.statsTiles },
  "stats-ledger": { kind: "dense", accepts: s => stats(s) >= 2, draw: C.statsLedger },
  "chart-annotated": { kind: "dense", draw: C.chartAnnotated },
  "chart-hero": { kind: "airy", accepts: s => s.chart!.series.length === 1 && s.chart!.type !== "donut", draw: C.chartHero },
  "chart-full": { kind: "dense", draw: C.chartFull },
  "diagram-rail": { kind: "dense", accepts: flow, draw: C.diagramRail },
  "diagram-steps": { kind: "dense", accepts: flow, draw: C.diagramSteps },
  "diagram-blocks": { kind: "dense", accepts: flow, draw: C.diagramBlocks },
  "diagram-classic": { kind: "dense", draw: C.diagramClassic },
  "compare-panels": { kind: "dense", draw: C.comparePanels },
  "compare-versus": { kind: "field", draw: C.compareVersus },
  "compare-columns": { kind: "dense", draw: C.compareColumns },
  "quote-giant": { kind: "airy", draw: T.quoteGiant },
  "quote-field": { kind: "field", draw: T.quoteField },
  "quote-centered": { kind: "airy", draw: T.quoteCentered },
  "team-row": { kind: "dense", draw: C.teamRow },
  "team-list": { kind: "dense", accepts: s => (s.people?.length ?? 0) >= 2, draw: C.teamList },
  "team-grid": { kind: "dense", draw: C.teamGrid },
  "pricing-cards": { kind: "dense", draw: C.pricingCards },
  "pricing-columns": { kind: "dense", draw: C.pricingColumns },
  "table-clean": { kind: "dense", draw: C.tableClean },
  "table-boxed": { kind: "dense", draw: C.tableBoxed },
  "image-full": { kind: "field", draw: M.imageFull },
  "image-framed": { kind: "dense", draw: M.imageFramed },
  "image-band": { kind: "field", draw: M.imageBand },
  "split-half": { kind: "field", draw: M.splitHalf },
  "split-inset": { kind: "dense", draw: M.splitInset },
  "split-arch": { kind: "dense", draw: M.splitArch },
  "canvas": { kind: "airy", draw: M.canvas },
};
export const compositionKind = (id: CompositionId) => REGISTRY[id].kind;

type DeckLike = Pick<Deck, "title" | "theme" | "assets" | "author"> & { slides?: Slide[] };
function context(deck: DeckLike, slide: Slide, index: number, total: number): Ctx {
  const dir = directionOf(deck.theme);
  const sections = (deck.slides ?? []).flatMap((entry, i) => entry.layout === "section" ? [{ index: i, title: entry.title }] : []);
  return { theme: deck.theme, dir, m: metrics(deck.theme), c: toneColors(deck.theme, slide.tone, dir.ground), prims: [], issues: [], index, total, deck, tone: slide.tone, slide,
    seed: hash(`${deck.title}|${slide.id}|${dir.id}`), sections };
}
function run(deck: DeckLike, slide: Slide, index: number, total: number, id: CompositionId, placement?: ImagePlacement): SlideScene {
  const ctx = context(deck, slide, index, total);
  const placed = placement ? placeImage(ctx, slide, placement, T.treatment(ctx)) : undefined;
  REGISTRY[id].draw(ctx, slide);
  placed?.finish(ctx);
  return { background: ctx.c.bg, prims: ctx.prims, issues: [...new Set(ctx.issues)], composition: id, ...(placement ? { imagePlacement: placement } : {}) };
}
/** Compositions a slide may take in this deck, the direction's preference first. */
export function candidates(deck: DeckLike, slide: Slide, index: number, total: number): CompositionId[] {
  const ctx = context(deck, slide, index, total), dir = ctx.dir;
  const ok = (id: CompositionId) => REGISTRY[id].accepts?.(slide, ctx) ?? true;
  // A closing with next steps is composed around them (its image, if any, takes the side rail).
  if (slide.layout === "closing" && (slide.points?.length ?? 0) >= 1) return ["closing-next"];
  if ((slide.layout === "cover" || slide.layout === "closing") && slide.image) return ["cover-image"];
  const preferred = (dir.compositions[slide.layout] ?? []).filter(ok);
  const rest = (COMPOSITIONS[slide.layout] as readonly CompositionId[]).filter(id => ok(id) && !preferred.includes(id) && id !== "cover-image");
  return preferred.length ? preferred : rest;
}

type Planned = { id: CompositionId; scene: SlideScene };
const plans = new WeakMap<object, { slides: Slide[]; plan: Planned[] }>();
function choose(deck: DeckLike, slide: Slide, index: number, total: number, previous: Planned | undefined, roleCount: number): Planned {
  const options = candidates(deck, slide, index, total);
  const requiresImage = Boolean(slide.image && (slide.layout === "cover" || slide.layout === "closing"));
  // Image-bearing covers have a semantic image requirement. A decorative
  // variant cannot override that requirement and silently discard a paid asset.
  // A text, number or chart slide with an image places it on a rail, band or scrim; the composition then keeps to the text zone.
  const placements = placementsFor(slide), passes: (ImagePlacement | undefined)[] = placements.length ? placements : [undefined];
  const fitsPass = (id: CompositionId, placement: ImagePlacement | undefined) => placement !== "full" || REGISTRY[id].kind === "airy";
  const tried: Planned[] = [];
  const attempt = (id: CompositionId, placement: ImagePlacement | undefined) => { const planned = { id, scene: run(deck, slide, index, total, id, placement) }; tried.push(planned); return planned.scene.issues.length ? undefined : planned; };
  const best = () => tried.sort((a, b) => a.scene.issues.length - b.scene.issues.length)[0];
  // Image-bearing covers have a semantic image requirement. A decorative
  // variant cannot override that requirement and silently discard a paid asset.
  if (slide.variant && (!requiresImage || slide.variant === "cover-image") && (REGISTRY[slide.variant as CompositionId].accepts?.(slide, context(deck, slide, index, total)) ?? true)) {
    const id = slide.variant as CompositionId, ways = passes.filter(placement => fitsPass(id, placement));
    for (const placement of ways.length ? ways : passes.slice(0, 1)) { const ok = attempt(id, placement); if (ok) return ok; }
    return best();
  }
  // The direction's signature composition comes first; later slides of the same layout cycle through the rest.
  // A cover starts from a composition picked by the deck's own title, so unrelated decks in one direction do not open alike.
  const shift = slide.layout === "cover" ? hash(`${deck.title}|${directionOf(deck.theme).id}`) % 7 : 0;
  const start = options.length ? (roleCount + shift) % options.length : 0;
  const order = options.map((_, i) => options[(start + i) % options.length]);
  // Then repeats the rhythm rules allowed, then any other composition of the layout the copy fits; a placement is exhausted before the next is tried.
  const others = requiresImage ? [] : (COMPOSITIONS[slide.layout] as readonly CompositionId[]).filter(id => id !== "cover-image" && !order.includes(id) && (REGISTRY[id].accepts?.(slide, context(deck, slide, index, total)) ?? true));
  for (const placement of passes) {
    for (const id of order) {
      if (!fitsPass(id, placement) || (previous && (id === previous.id || (REGISTRY[id].kind === "field" && REGISTRY[previous.id].kind === "field" && order.length > 1)))) continue;
      const ok = attempt(id, placement); if (ok) return ok;
    }
    for (const id of [...order, ...others]) {
      if (!fitsPass(id, placement) || tried.some(entry => entry.id === id && entry.scene.imagePlacement === placement)) continue;
      const ok = attempt(id, placement); if (ok) return ok;
    }
  }
  return best() ?? { id: order[0], scene: run(deck, slide, index, total, order[0], passes[0]) };
}
/** The composition of every slide in a deck (memoised per deck object). */
export function planDeck(deck: Deck): Planned[] {
  const cached = plans.get(deck);
  if (cached && cached.slides === deck.slides && cached.plan.length === deck.slides.length) return cached.plan;
  const counts = new Map<string, number>(), plan: Planned[] = [];
  deck.slides.forEach((slide, index) => {
    if (slide.composition && (slide.layout === "cover" || slide.layout === "closing")) { plan.push({ id: slide.layout === "cover" ? "cover-poster" : "closing-ask", scene: slideCoverScene(deck.theme, slide, deck.assets, deck.author) }); return; }
    const count = counts.get(slide.layout) ?? 0;
    plan.push(choose(deck, slide, index, deck.slides.length, plan[index - 1], count));
    counts.set(slide.layout, count + 1);
  });
  plans.set(deck, { slides: deck.slides, plan });
  return plan;
}

export function composeSlide(deck: DeckLike, slide: Slide, index: number, total: number): SlideScene {
  if (slide.composition && (slide.layout === "cover" || slide.layout === "closing")) return slideCoverScene(deck.theme, slide, deck.assets, deck.author);
  if (deck.slides && deck.slides[index] === slide) return clone(planDeck(deck as Deck)[index].scene);
  // A slide outside its deck (e.g. a draft being checked): plan it after its would-be predecessor.
  const previous = deck.slides && index > 0 && deck.slides[index - 1] ? planDeck(deck as Deck)[index - 1] : undefined;
  const count = (deck.slides ?? []).slice(0, index).filter(entry => entry.layout === slide.layout).length;
  return choose(deck, slide, index, total, previous, count).scene;
}
const clone = (scene: SlideScene): SlideScene => structuredClone(scene);
