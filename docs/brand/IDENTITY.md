# Makeborne identity

## Current direction — modern continuous M (supersedes earlier direction)

The human rejected the earlier folded-paper branding and raster imagery. The current application identity uses a single filled rounded double-arch M/ribbon. Its consistent silhouette is defined by actual native SVG path geometry; it is not a new image-generated asset or an imitation of another application's mark.

Palette: white #FFFFFF, off-white #FAFAFA, ink #18181B, subtle border #E8E8EC and a sparingly used coral #F76F53. Use the default ink mark on light backgrounds, white on ink, and coral as a small expressive accent. The application wordmark remains Makeborne in Inter 600 with restrained negative tracking. Soft ambient blue/coral belongs to supporting interface atmosphere, not multi-colour logo geometry.

The SVG files, application BrandMark component and app icon share the same path. The silhouette avoids narrow fold details so it remains practical at small sizes. Favicon background/foreground adapt to light and dark appearance. Native SVG rendering was visually inspected at actual 16, 24, 32 and 64 pixels in ink on off-white and white on ink; the two arches remain open and the three stems retain separation. Final browser/header placement still needs review in the actual UI. This is not a trademark-clearance or brand-superiority claim.

Earlier generated paper artwork, concept sheets and brand boards below are historical exploration. They no longer describe the current identity and must not be shown as the current brand board or used as visible application hero artwork. Their genuine-generation provenance remains intact; supersession does not retroactively make them production customer assets.

## Selected concept

The first/top concept in `public/brand/makeborne-logo-concepts.png` is selected for the implementation direction. Its folded, angular M preserves the strongest letter recognition of the three options. The central fold gives the otherwise simple mark a useful asymmetry. The second concept reads more like an arch; the third depends on subtle curves that are less clear at small sizes.

`makeborne-mark.svg` is a manually authored geometric refinement inspired by the selected generated concept. It contains actual vector paths, not an embedded raster or an automatic trace. It deliberately removes generated shading. Monochrome and white variants share its geometry. Use the native application font for the visible Makeborne wordmark; these files do not claim to contain a custom outlined wordmark.

## Colour and usage

- Cobalt: #3358D4
- Ink: #16181D
- Warm canvas: #F8F7F4
- White: #FFFFFF

Use the coloured mark on warm white, the monochrome mark in print, and the white mark on ink. Preserve proportions. Use the favicon-specific mark for browser tabs. Keep clear space equivalent to approximately one fifth of the symbol width. Pair with a native Inter wordmark, medium/semibold weight and restrained negative tracking.

## Generated artwork

`public/artwork/makeborne-paper-studio.png` is genuine built-in image-generation output: an editorial folded-paper M sculpture, matte cobalt with ivory sheets and ink planes. It is decorative brand artwork, not a sample of an output created by the production application.

## Status

Naming and logo direction are recommendations. No trademark clearance, domain ownership, production image API integration, or commercial exclusivity is established by these assets.

## Practical integration review

## Recognition and production rules

The signature is the folded M: two substantial legs, an asymmetric fold, and a diagonal negative-space cut. Keep this geometry fixed rather than generating a new logo for each surface. The application uses the shared `BrandMark` component; standalone SVGs are the export assets. The favicon uses the dedicated inset version so its silhouette stays readable within the browser's small square.

- Use the symbol with the Makeborne name for first encounters. Use the symbol alone for the favicon and familiar compact navigation.
- Primary wordmark: Inter, weight 650, tracking -0.055em. Keep the name in mixed case as Makeborne; do not alternate stylised spellings.
- Minimum symbol size: 16 CSS pixels. Prefer 24–32 pixels in navigation. The one-colour variant is preferable for tiny applications and reproduction.
- Clear space: at least one fifth of the symbol width, measured outside its visible silhouette. Never stretch, rotate, add shadows or place a gradient inside the mark.
- Warm white backgrounds use the cobalt/ink mark; ink backgrounds use the white mark. Avoid placing the mark directly over busy artwork.
- Brand artwork may have texture and dimension. The actual logo stays flat, crisp and reproducible in one colour.
- Keep one stable logo across websites, books, presentations, account pages and client workspaces. Customer-created brands remain distinct from Makeborne's own identity.

The design target is a recognisable professional identity with the simplicity of established brands. Recognition itself must be earned through consistent use; no comparative ranking or customer recognition study has been established.

The folded M was rendered and visually inspected at actual 16, 24 and 32 pixel dimensions on warm white, and as a white mark on ink. Its legs and diagonal gap remain recognisable; the small dark fold is less prominent at 16 pixels. Use the one-colour mark where maximum micro-size simplicity matters. Use the white variant on dark backgrounds: the coloured variant's ink fold has insufficient separation from an ink background.

The symbol is a restrained geometric M, with diagonal negative space as its characteristic detail. This is a practical professional starting identity, not evidence of global brand recognition, trademark uniqueness, or superiority to established logos. Extra ornamental complexity would reduce small-size clarity. Recognition will also depend on consistent repeated use and customer experience.

`makeborne-brand-board.svg` and `.png` combine the selected true vector geometry, genuine generated artwork, palette, typography direction, dark application and actual small-size marks. The board is native composition, not a newly generated image. `mark-size-review.png` records the practical size comparison. `render-brand-board.cjs` reproduces both boards with Sharp.

Application layout imports Inter and Source Serif 4, matching the planned identity. Application CSS must apply their font variables. The standalone board names those preferred fonts but its rendering can use Arial/Georgia fallback when they are unavailable; the board is not a specimen guaranteeing those exact font outlines.
