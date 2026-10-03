# Visual creation styles — 2026-10-03

The creation wizard now offers all six authored gallery directions without requiring a gallery visit first. Original concepts appear as thumbnails. Saved style values override authored defaults, and a changed palette or font suppresses the original concept thumbnail to avoid misrepresenting it.

Creating a project retains only its chosen missing style in the same validated workspace save as the project. A failed save keeps the creation dialog/draft. Existing custom styles are not overwritten. Gallery images remain inspiration; they are not inserted into the user's content as generated artwork.

Verification:

- Ten offline assertions passed for unique options, exact palette retention, idempotent retention, custom override preservation, thumbnail suppression and unknown-style rejection.
- Production build and TypeScript passed. Focused lint has zero errors and two existing `no-img-element` warnings elsewhere in the studio.
- Browser: all nine options visible (three base styles plus six directions); selected Field Guide, created `QA — editorial style persistence` on isolated localhost origin, and reloaded. The editor still selected Field Guide. Test project ID: `a801f29f-5f98-44d8-9719-38d471eba57f`.
- Screenshot reviewed after correcting thumbnail grid placement. No horizontal overflow was visible in the corrected desktop dialog.

This delivery does not establish generated artwork quality, PDF/PPTX layout parity, or live provider availability. Those release requirements remain separate.
