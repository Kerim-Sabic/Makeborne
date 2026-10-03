# Makeborne redesign — 3 October 2026

The user rejected the original warm editorial landing page, folded M and generated paper imagery. The current direction replaces those visible surfaces with a compact rounded mark, neutral product chrome, a central creation composer and authored style previews. Earlier brand-board files are historical and do not describe the current UI.

## Research applied

- [Lovable](https://lovable.dev/): direct browser inspection of its current entry screen showed a dominant composer, quiet navigation and a project gallery. Makeborne adopts a clear starting action and separates format selection from the prompt; its own blue/coral atmosphere and typography remain authored for this product.
- [Bolt](https://bolt.new/): direct browser inspection showed the prompt and format choices grouped together. Makeborne keeps website/book/presentation choices adjacent to the brief, with real text-file import and a working continuation action.
- [Claude artifacts](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them): content has a dedicated work surface. Makeborne keeps the artifact preview central and places editing controls around it.
- [ChatGPT writing blocks](https://help.openai.com/en/articles/20001246-working-with-writing-blocks-and-code-blocks-in-chatgpt): direct editing, undo and saved context are useful workflow primitives. Makeborne preserves its manual editor and version history while simplifying entry into them.
- [Codex](https://openai.com/index/introducing-the-codex-app/): ongoing work is organised into persistent projects. Makeborne keeps client relationships, artifacts and revisions together rather than discarding context between creations.
- [Gamma creation](https://help.gamma.app/en/articles/15002203-how-do-i-create-with-agent-in-gamma) and [visuals](https://help.gamma.app/en/articles/11856101-how-do-i-use-the-visuals-menu-in-gamma): clarify the brief and establish the visual direction early. Makeborne carries the selected direction into project setup, with source text distinct from instructions.
- [Linear's interface refresh](https://linear.app/now/behind-the-latest-design-refresh): reduce the visual weight of navigation and keep actions predictable. Makeborne uses a quieter sidebar, compact controls and stronger focus on the current work.

These are observed/documented interaction patterns and our design inferences, not claims of equal capability or superior usability. No competitor assets or private project contents were reused.

## Interaction contract

The home composer stores a bounded brief in session storage and navigates to project setup. It never pretends that the brief is generated output. Template previews provide direction and a starter brief. Original user content remains separate. The local editor still supports clients, projects, snapshots and exports. Live generation remains unavailable under the current no-paid-calls instruction.

Authentication is being completed against real Supabase flows, with configuration and migration checks. It cannot be described as working live until a configured project, email delivery and the full account lifecycle have been exercised.

## Visual rules

White/off-white surfaces, ink text, fine neutral borders, restrained coral accent, Inter for product chrome. The hero uses an authored CSS atmosphere rather than generated paper art. Style previews are native typography and geometry. Secondary text must remain readable; small labels must not carry essential instructions. Focus states, mobile layouts and reduced motion are part of the implementation.

## Verification for this revision

- Production build completed successfully; TypeScript passed.
- ESLint reported no errors and two existing warnings for user-uploaded inline artwork images.
- Browser checks at desktop and 390px mobile widths: home composer, template gallery, client workspace entry and honest account-unavailable screen.
- Typed home brief was preserved when selecting Signal; its actual palette reached step three. Closing and reopening restored the audience and brief.
- Six direction snapshots are schema validated and carry optional background/text colours into local previews and HTML/PDF/PPTX/EPUB renderers. Complete gallery compositions are inspiration, not implemented generated layouts.
- Signup, confirmation, login and recovery code are implemented. Live provider, SMTP, two-tenant RLS and production generation/export jobs remain unverified and gated. See AUTH_SETUP.md.
- No paid AI calls, purchases or deployment were made. Repository publication is distinct from a production launch.
