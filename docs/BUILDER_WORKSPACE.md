# Project workspace — 2026-10-04

## Implemented

- Homepage Create submits the saved brief directly to the existing guarded project-creation flow. Successful saves open a permanent project URL, with conversation on the left and Preview on the right.
- Both account and device projects use the new workspace. Dashboard navigation is removed while a project is open; Back returns to projects.
- Edit and History expose the existing editing, saving, recovery and version controls. Account permission and conflict handlers remain in place.
- The conversation displays the actual saved brief. Follow-up instructions are explicitly saved only in the current browser tab and marked **not applied**. They are not sent to a model or cloud queue. Create/Plan and effort controls are available in the composer.
- Initial drafts show an empty preview state. Existing content uses the actual artifact renderer. No generated content or AI progress is simulated.
- Mira, Atlas and Ellis use new transparent PNGs from the built-in image generator. Alpha channels and transparent corners were checked; the avatar containers no longer add a background.

## Verification

- Production build and TypeScript passed.
- Focused ESLint passed with the two existing unoptimized-image warnings in the local editor.
- Existing creation-payload checks: 13 passed.
- Browser: a homepage Create prompt saved an account project and opened its split workspace without a setup form or plan-confirmation step.
- Browser: a follow-up note persisted after reload and remained explicitly marked not applied. Effort choices opened above the bottom composer. Account Edit and device Edit/History controls were reachable.
- Browser: transparent avatars rendered without white rectangles in the advisor list and welcome area.
- QA account artifact: `2746d874-c376-4be5-8643-3c6a4b8b9d0f`, workspace `e68ff1eb-ed26-42ac-8864-689451e39c30`. The fictional ceramics brief and QA instruction are test material. Existing user content was not edited.

## Limits

Generation and live advisor replies are still disconnected. Publishing, payments and production administration are not activated by this layout change. Follow-up instructions are tab-local and do not sync across devices. Plan selected before initial creation retains its explicit planning flow; default Create skips it.

See HOSTING.md for deployment requirements and separate customer-site publication work.
