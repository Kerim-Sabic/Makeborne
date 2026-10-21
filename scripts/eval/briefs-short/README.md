# Short-prompt set: 8 deliberately vague first prompts

Design round 3 (21 October 2026). Most people start with a few words ("website for my dentist"), not a 1,000-character golden brief. These eight prompts measure what Makeborne does with that first prompt: the one-click design questions, the brief enhancer and the build.

- `<id>.json`: `id` (`sNN-<subject>`), `format` (`website`), `direction`, `title` (the project title), `brief` (the exact text typed), `simulatedAnswers` and `notes`.
- `simulatedAnswers`: the answers a typical owner would give to the on-device design questions, fixed in advance so the "answered" variant is deterministic: `vibe`, `goal`, `theme` and `imagery` are option values (`auto` = "You choose" / "Let Makeborne choose"), `sections` is the list of must-have chips. Only questions the app actually asks for the prompt are answered; AI-tailored questions are not simulated (they cost a call and their answers cannot be fixed in advance).
- `index.json`: SHA-256 of each file's exact bytes. Frozen like the golden set: never edit a brief; add a new id instead.

Variants (`scripts/eval/direct-run.mjs --variant`): `original` (the prompt as typed), `enhanced` (brief enhancer, no answers) and `answered` (simulated answers + brief enhancer). Judge pairs: answered vs enhanced, enhanced vs original, answered vs original, with the same blind, position-swapped Claude judge as the golden rounds.
