# Automatic generation and clipping implementation

Reviewed 2026-10-03. Research and implementation mapping only: no models were downloaded, paid APIs called, clips rendered, or routing slots enabled by this work.

## Source of truth recovered

The original `Offerloom_Research_Launch_Pack.zip` exists at the user-provided temporary path. SHA-256: `764e06a55af1681c6a4c1a4df9a9c8b837c9a50b2c8bc44855467654f6d95d17`.

Reviewed its `MEDIA_PIPELINE_SPEC.md`, `OPEN_SOURCE_AND_PROVIDER_REGISTER.csv`, `V4_IMPLEMENTATION_ADDENDUM.md`, relevant master-prompt requirements (including section 15), and media/license release gates. The source package specifies a transcript-aware clipping pipeline inside a project's Launch area, after the core creation proof. It does not specify one universal “clipping model,” an entire video editor replacement, or automatic viral outcomes. Synthetic video is a distinct optional beta.

The user's newer instruction supersedes older provider-selection UI: customers choose an outcome and approve a bounded credit estimate; the service orchestrates its internal models automatically. Provider/deployment identifiers remain internal evidence. Any processing disclosure required by privacy terms remains available without turning the creation flow into a model picker.

## Recommended implementation slice

Start with authorized spoken teaching, interviews, and workshops. Upload → transcript → three context-preserving suggestions → adjust crop/captions → real preview → MP4 and optional SRT/VTT. Keep the upload private by default. Do not claim sports, gaming, silent demonstrations, or complex visual storytelling are supported until separately evaluated.

Implement owned orchestration around reusable components. Compare ClipsAI's candidate segmentation with our project-aware selection; do not import its whole dependency graph into the web server. Use the same approved recording for source-linked books, slides, offers, and promotional clips, while preserving each output's independent narrative and release approval.

## Components and current primary-source findings

These are screening findings, not clearance of an unpinned deployment. Exact revisions, notices, transitive dependencies, checkpoints, and binary configuration must be recorded before installation and release.

| Component | Role and current evidence | Decision |
| --- | --- | --- |
| faster-whisper | CTranslate2 transcription engine; its code is MIT. [License](https://raw.githubusercontent.com/SYSTRAN/faster-whisper/master/LICENSE), [runtime documentation](https://github.com/SYSTRAN/faster-whisper) | First transcription worker candidate. Pin engine and selected converted weights; measure language accuracy, memory, and runtime ourselves. |
| Whisper weights | Upstream explicitly releases its code and weights under MIT. Model variants have different language/latency tradeoffs. [Official repository](https://github.com/openai/whisper) | Select through fixtures rather than assuming the largest or newest is economical. Verify converted artifact provenance too. |
| WhisperX | Current code license is BSD-2-Clause. Alignment and diarization introduce additional checkpoints. [License](https://raw.githubusercontent.com/m-bain/whisperX/main/LICENSE), [repository](https://github.com/m-bain/whisperX) | Optional alignment when required by caption quality. Do not automatically run a second full ASR pass. |
| ClipsAI | MIT library; documented for audio-centric narratives. It derives candidates from transcripts and has a separate resizing path using diarization. [License](https://raw.githubusercontent.com/ClipsAI/clipsai/main/LICENSE), [documentation](https://github.com/ClipsAI/clipsai) | Adapt/compare behind a candidate-selector interface; not a production SaaS backend. |
| ClipsAI dependency scope | Its setup includes sentence-transformers, face tooling, MediaPipe, Pyannote, PyTorch, and scene detection. Its ClipFinder uses semantic segmentation, not a proven engagement predictor. [Dependency manifest](https://raw.githubusercontent.com/ClipsAI/clipsai/main/setup.py), [selector implementation](https://raw.githubusercontent.com/ClipsAI/clipsai/main/clipsai/clip/clipfinder.py) | Audit selected files and actual model downloads; never translate a segmentation score into a “viral score.” |
| PySceneDetect | BSD-3-Clause code. [License](https://raw.githubusercontent.com/Breakthrough/PySceneDetect/main/LICENSE) | Scene-boundary assistance. A visual cut does not establish a useful or faithful excerpt. |
| FFmpeg | License obligations depend on build options and linked components; GPL and nonfree configurations require separate treatment. [Official legal page](https://ffmpeg.org/legal.html) | Pin and record an audited binary configuration. Use fixed argument arrays, never shell strings supplied by users. |
| MediaPipe | Framework license is Apache-2.0. [License](https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE) | Optional composition guidance after selected model review. No identity or sensitive-trait inference. Manual crop and fit-to-frame remain available. |
| Pyannote diarization 3.1 | The model card labels the pipeline MIT but requires acceptance/contact-information sharing to access files. [Model card](https://huggingface.co/pyannote/speaker-diarization-3.1) | Optional gated dependency, not silently provisioned. Review its supporting checkpoints and do not require it for basic clipping. |
| Remotion | Custom license. Current FAQ permits qualifying small teams and describes different company licensing; restrictions still apply. [FAQ](https://www.remotion.dev/docs/license/faq), [pricing](https://www.remotion.dev/docs/license/pricing) | Optional branded compositions after actual organization/use eligibility review. Start with a fixed renderer without introducing a purchase requirement. |
| OpenCut | Current main README describes a rewrite and directs present use to classic. [Repository status](https://github.com/OpenCut-app/OpenCut) | Optional classic UI-module study at a pinned revision. Do not depend on promised rewrite/headless APIs. |
| OpenShorts cloud directory | Separate commercial license. [Directory license](https://raw.githubusercontent.com/mutonby/openshorts/main/cloud/LICENSE) | Do not copy into this commercial service without a suitable written agreement. |
| ClippyMe | Its README says internet exposure is unsupported and lists additional processing dependencies. [Security and stack](https://github.com/fralapo/clippyme) | UX reference only; do not expose the app as our multi-tenant backend. |
| Wan2.2 | Official repository says its models use Apache-2.0. It generates synthetic footage rather than extracting source clips. [Repository](https://github.com/Wan-Video/Wan2.2) | Separate disabled beta for optional B-roll after exact checkpoint, runtime, cost, rights, and quality checks. |

No commercial clearance is inferred for an entire model family from one variant. The original plan's optional image checkpoints and LTX alternative remain uninstalled proposals; their present cards and exact agreements need another focused review when selected. Historical hosted model names in the source package are not assumed to be current deployable API IDs.

## Mapping to the existing code

At inspection, `src/lib/routing/registry.ts` defines eight unconfigured slots; `src/lib/routing/contracts.ts` provides validation and bounded quotes. No slot contains an executable configured model.

| Existing internal slot/capability | Intended implementation | Missing work |
| --- | --- | --- |
| `open-weight-transcription` / `transcription` | Private faster-whisper worker; optional alignment adapter | Pinned checkpoint, worker protocol, upload integration, timing schema, real evaluation, metering |
| Text routes / `clip_selection` | Project-aware transcript selection, optionally compared with ClipsAI candidates | Selector adapter, evidence/context windows, approved transcript input, quality fixtures |
| `clip-render-worker` / `clip_render` | Audited FFmpeg renderer with fixed crop/caption composition | Actual worker, manifests, preview storage, resource isolation, output inspection |
| `openai-image` / `image`, `visual_slide` | User-required final book/slide art route | Credentials, approved bounded spend, adapter, actual output checks |
| Hosted/self-hosted text routes | Automatic extraction, analysis, structure, drafting, revisions | Real configured deployments and quality/cost evaluations; no blanket fan-out |
| `research_sources` | Authorized retrieval with dated source evidence | No registry candidate; text generation alone cannot supply verified research |
| No synthetic-video route | Optional generated B-roll | Separate schema/capability, endpoint and entitlement verification; not a clipping prerequisite |

Do not flip readiness flags because this document exists. The current quote/ledger contracts do not upload video, run ASR, persist clip manifests, enqueue workers, or settle real usage. Current `/api/capabilities` correctly keeps generation disabled.

## Concrete next implementation sequence

1. **Canonical media contracts.** Add versioned `MediaAsset`, `TranscriptVersion`, `TranscriptSegment`, `ClipSpec`, `CropTrack`, `CaptionTrack`, and `MediaRender`. Store integer time units plus rational source timebase; keep source and output timelines separate. Bind all derivatives to original hash, project, workspace, version, and rights grant. Validate intervals, resource bounds, and output aspect ratio in code.
2. **Private upload and probe.** Add scoped upload intents and signed access through one AssetStore abstraction. Quarantine until integrity/probe checks pass. Enforce limits on bytes, duration, resolution, streams, codecs, rotation and temporary disk. Retain original and produce a bounded proxy/audio derivative. Private R2 objects require our authorization; Supabase RLS does not automatically cover R2.
3. **Isolated worker contract.** Node owns durable jobs and transactional reservations. A pinned Python worker accepts fixed operation types, signed inputs and job-scoped callback/output authority. No global service keys, arbitrary URL fetching, dependency installation, shell expressions, or direct pg-boss manipulation. Persist cancellation checkpoints and bounded attempts.
4. **Transcription and captions.** Evaluate an exact faster-whisper/weight combination. Preserve source timestamps, language and review flags; optionally align only where needed. Keep original recognition and user corrections separate. Export captions from approved timeline mappings, not from regenerated prose.
5. **Candidate selection.** Consider full local context around intervals, project purpose, meaningful sentence boundaries and shot changes. Enforce minimum/maximum length, deduplicate overlap, and reject cuts that remove negation or essential qualifications. Return transcript evidence and a short suitability explanation. Users can change start/end and reject proposals.
6. **Crop and actual preview.** Default to fit-to-frame or manual crop until validated tracking is available. Preserve screen-share text and demonstrations. Generate a real low-resolution preview using exactly the proposed timeline/crop/caption manifest; changing that manifest invalidates approval and requires preview regeneration.
7. **Final render and delivery.** Reserve a bounded scope; render MP4 and optional SRT/VTT, decode/inspect the result, store hash/manifests and source links. Deliver a private signed download. Export does not publish to a social account.
8. **Measure and activate.** Record transcript correction effort, accepted excerpt rate, context preservation, crop stability, encode time, failures, and accepted-clip cost. Enable only after permissions, cancellation/retry, accounting, and representative device playback evidence pass. All live spend still requires the user's budget authorization.

## Free weights are not free operation

Permissive software/weights can avoid a per-call model license fee. Processing still consumes CPU/GPU time, storage, upload/proxy operations, encoding, maintenance, review, failed attempts and support. Local hardware also has finite capacity. Do not promise cheaper credits before measuring accepted-output cost.

Price source analysis separately from bounded final clips, resolution, variants and revisions. Reuse an unchanged approved transcript and proxy by content hash within the authorized workspace. Customer credits and vendor/infrastructure expense remain separate exact ledgers. Reserve before work, settle on measured completed work, and reconcile unknown outcomes instead of blind retries. Ordinary CRM edits stay unmetered as the original plan requires.

## Original release evidence still required

- `OL-V4-061–065`: pinned dependency/checkpoint identity, directory restrictions, composition-license eligibility, weight variants and actual codec/model scope.
- `OL-V4-067–069`: private-source grants, adversarial upload/resource tests, variable-rate and rotated-input timing/sync.
- `OL-V4-070–072`: negation/qualification fixtures, caption correction fidelity, safe crop fallback.
- `OL-V4-073–076`: scoped worker inputs, real playable output, export/publication separation, cancellation/retry/accounting behavior.

Fixtures must cover one/two speakers, portrait/landscape, screen share, quiet/noisy audio, accented names, fast speech, music under speech, silence, malformed/oversized input, long captions, and interrupted uploads/jobs. None of these gates is passed by license research or a rendered UI placeholder. Runtime clipping remains unimplemented.
