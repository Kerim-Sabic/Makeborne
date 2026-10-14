"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, Eye, FileCode2, Hammer, ImageIcon, ListChecks, Loader2, Paperclip, Sparkles } from "lucide-react";
import { EFFORT_LEVELS, EFFORT_PRESENTATION, type EffortLevel } from "@/lib/routing/effort";
import type { SitePlan } from "@/lib/builder/plan";
import type { DocumentSource } from "@/lib/documents/schema";
import { captureDesign } from "@/lib/builder/design-capture";
import { autoReviewRounds, reviewCoverageIssue, reviewCreditCeiling } from "@/lib/builder/review-policy";
import { BUILDER_EFFORT } from "@/lib/builder/pricing";
import { PLAN_CEILING_CREDITS } from "@/lib/builder/plan";
import { readCloudImage } from "./cloud-api";
import PlanCard from "./plan-card";
import { usePlanMode } from "./use-plan-mode";
import { useBuilderOperation } from "./use-builder-operation";
import type { OperationRequest, OperationSnapshot } from "@/lib/builder/operation-contract";
import { recoveryPreview } from "@/lib/builder/recovery-preview";
import { BUILDER_ATTACHMENT_ACCEPT, serializeBuilderRequest, prepareBuilderAttachments, type BuilderAttachment } from "@/lib/builder/attachments";
import { attachmentOwner, projectAttachmentKey, retainBuilderAttachmentSnapshot, bindBuilderAttachmentSnapshot, readBuilderAttachmentSnapshot, type Attachment as StoredAttachment } from "@/lib/attachments";
import { AttachmentList, useFileAttachments } from "./file-attachments";

type Activity = { id: string; kind: "file" | "image" | "note" | "error"; label: string; done: boolean };
type Shot = { label: string; url: string; viewport: string };
type Turn = { id: string; role: "user" | "assistant"; text: string; activity: Activity[]; state: "streaming" | "done" | "error"; credits?: number; plan?: { title: string; revision: number } | true; review?: boolean; shots?: Shot[] };
type Attachment = BuilderAttachment;
type Live = { files: Record<string, string>; assets: { id: string; path: string }[]; document?: DocumentSource; focus?: string };
type RunResult = { version: number; changed: boolean; touched: number; finished: boolean; operation?: OperationSnapshot };
export type LiveUpdate = { files: Record<string, string>; assets: { id: string; path: string }[]; building: boolean; document?: DocumentSource; focus?: string };
const COPY = {
  website: { title: "What should we build?", intro: "Describe the website, its audience and the feeling you want. Attach a logo, screenshot or brief for reference. Then keep chatting to refine it.", start: "A premium website for a makeup brand selling three products…", edit: "Ask for a change — e.g. make the hero bolder and add an FAQ" },
  presentation: { title: "What's the presentation?", intro: "Describe the audience, the goal and the key message. Attach notes, data or a brief. Slides appear live as they are written; then refine by chat.", start: "A 10-slide seed pitch for a community solar startup…", edit: "Ask for a change — e.g. make slide 4 a chart, or a warmer palette" },
  book: { title: "What's the book?", intro: "Describe the story or topic, the reader, the tone and the length. Pages are typeset live at 6 × 9 in with illustrations; then refine by chat.", start: "A short illustrated children's book about a lighthouse cat…", edit: "Ask for a change — e.g. shorten chapter 2, or a warmer palette" },
} as const;

const newId = () => crypto.randomUUID();
/** Follow-up runs after a time-limited run saved partial progress. */
const MAX_CONTINUATIONS = 2;

/** Project images as data URLs keyed by their in-code path (/images/x.webp),
 * so the sandboxed capture frame needs no network access. */
async function assetDataUrls(assets: Live["assets"], scope: { accountId: string; workspaceId: string; artifactId: string }): Promise<Record<string, string>> {
  const controller = new AbortController();
  const entries = await Promise.all(assets.map(async asset => {
    try {
      const blob = await readCloudImage(`/api/cloud/workspaces/${scope.workspaceId}/artifacts/${scope.artifactId}/assets/${asset.id}`, scope.accountId, controller.signal);
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      return [`/${asset.path.replace(/^public\//, "")}`, url] as const;
    } catch { return null; }
  }));
  return Object.fromEntries(entries.filter(entry => entry !== null));
}

/** Chat-driven website builder: every message streams real edits into the
 * project, previews them live and saves a new version when finished. After
 * first builds and large changes it looks at the rendered result (desktop and
 * mobile screenshots) and fixes visual problems in a review pass. */
export default function LiveBuilder({ accountId, workspaceId, artifactId, version, history, baseFiles, baseAssets, defaultEffort, disabled, disabledReason, autoStart, autoStartMode, prefill, onLive, onSaved, kind = "website", baseDocument }: {
  accountId: string; workspaceId: string; artifactId: string; version: number;
  /** Text placed in the composer for the user to review, e.g. client feedback. Never sent automatically. */
  prefill?: { key: string; text: string } | null;
  history: { number: number; summary: string }[];
  baseFiles: Record<string, string>; baseAssets: { id: string; path: string }[];
  defaultEffort?: EffortLevel; disabled?: boolean;
  /** Shown while disabled, when the reason is something the user can act on. */
  disabledReason?: string; autoStart?: string | null;
  /** "plan" starts the first message in Plan mode (from a Plan-first creation). */
  autoStartMode?: "create" | "plan";
  onLive: (update: LiveUpdate | null) => void;
  onSaved: () => Promise<void> | void;
  /** Books and presentations use the structured document builder: no Plan mode or visual review. */
  kind?: "website" | "book" | "presentation"; baseDocument?: DocumentSource;
}) {
  const copy = COPY[kind], website = kind === "website";
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [effort, setEffort] = useState<EffortLevel>(defaultEffort ?? "medium");
  const sourceOwner = attachmentOwner(accountId);
  const sourceContext = projectAttachmentKey(`${accountId}:${workspaceId}:${artifactId}`);
  const sources = useFileAttachments(sourceOwner, sourceContext);
  const [preparingSources, setPreparingSources] = useState(false);
  const sourceLock = useRef(false);
  const sourceSession = useMemo(() => ({ active: true, accountId, workspaceId, artifactId }), [accountId, workspaceId, artifactId]);
  useEffect(() => { sourceSession.active = true; return () => { sourceSession.active = false; }; }, [sourceSession]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [balance, setBalance] = useState<{ available: number; unlimited: boolean } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);
  const authorizing = useRef(false);
  const [previewingRecovery, setPreviewingRecovery] = useState<{ runId: string; version: number } | null>(null);
  const [chosenMode, setMode] = useState<"create" | "plan" | null>(null);
  const planner = usePlanMode({ accountId, workspaceId, artifactId });
  const { actionKey: buildActionKey, operation: buildOperation, recovery: buildRecovery, checking: checkingBuildOperation, recoveryNotice: buildRecoveryNotice, ready: operationReady, hasPrevious: hasPreviousOperation,
    begin: beginOperation, observe: observeOperation, refresh: refreshOperation, authorize: authorizeOperation, recover: recoverOperation } = useBuilderOperation({ accountId, workspaceId, artifactId });
  // An open draft plan from an earlier session keeps the composer in Plan mode.
  const mode = !website ? "create" : chosenMode ?? (planner.restored ? "plan" : "create");
  const operation = mode === "plan" ? planner.operation : buildOperation;
  const checkingOperation = mode === "plan" ? planner.checking : checkingBuildOperation;
  const recoveryNotice = mode === "plan" ? planner.recoveryNotice : buildRecoveryNotice;
  const checkCurrentOperation = mode === "plan" ? planner.refreshOperation : refreshOperation;
  const operationRunning = buildOperation?.status === "running" || planner.operation?.status === "running";
  const draftPlan = planner.active && planner.active.stored.status === "draft" ? planner.active : null;
  const [prefilled, setPrefilled] = useState<string | null>(null);
  if (prefill && prefill.key !== prefilled) { setPrefilled(prefill.key); setDraft(prefill.text.slice(0, 8000)); }
  useEffect(() => { if (prefilled) composer.current?.focus(); }, [prefilled]);

  const refreshBalance = useCallback(() => {
    fetch("/api/credits", { cache: "no-store", headers: { "X-Makeborne-Account": accountId } })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (value && typeof value.available === "number") setBalance({ available: value.available, unlimited: Boolean(value.unlimited) }); })
      .catch(() => undefined);
  }, [accountId]);
  useEffect(() => { refreshBalance(); }, [refreshBalance]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }); }, [turns]);

  useEffect(() => {
    if (!buildActionKey || !buildOperation) return;
    void bindBuilderAttachmentSnapshot(sourceOwner, sourceContext, buildActionKey, buildOperation.id).catch(error => {
      if (sourceSession.active) setNotice(error instanceof Error ? error.message : "The original source files could not be retained.");
    });
  }, [buildActionKey, buildOperation, sourceContext, sourceOwner, sourceSession]);

  const update = (id: string, change: (turn: Turn) => Turn) => setTurns(current => current.map(turn => turn.id === id ? change(turn) : turn));

  /** Stream one /api/build run into a reply turn, mirroring edits into the live
   * preview. Resolves with the saved result, or null when the run failed. */
  const stream = useCallback(async (payload: Record<string, unknown>, replyId: string, live: Live): Promise<RunResult | null> => {
    const activity = (item: Omit<Activity, "id">, key?: string) => update(replyId, turn => {
      const existing = key ? turn.activity.findIndex(entry => entry.id === key) : -1;
      if (existing >= 0) { const next = [...turn.activity]; next[existing] = { ...next[existing], ...item }; return { ...turn, activity: next }; }
      return { ...turn, activity: [...turn.activity, { id: key ?? newId(), ...item }] };
    });
    const touched = new Set<string>();
    let result: RunResult | null = null, finished = false;
    let latestOperation: OperationSnapshot | null = null;
    const envelope = payload.operation as OperationRequest | undefined;
    let boundOperation: string | null = null;
    const rememberSources = async (operation: OperationSnapshot) => {
      if (!envelope || !("actionKey" in envelope) || boundOperation === operation.id) return;
      try { await bindBuilderAttachmentSnapshot(sourceOwner, sourceContext, envelope.actionKey, operation.id); }
      catch { if (sourceSession.active) setNotice("Your source files could not be linked to this request on this device. The build can finish; check the saved result before continuing."); }
      boundOperation = operation.id;
    };
    try {
      const response = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId },
        body: serializeBuilderRequest({ workspaceId, artifactId, ...payload }),
      });
      if (!sourceSession.active) return null;
      if (!response.ok || !response.body) {
        const failure = await response.json().catch(() => null);
        if (failure?.operation) { latestOperation = observeOperation(failure.operation); if (latestOperation) await rememberSources(latestOperation); }
        throw new Error(failure?.error?.message ?? "The builder couldn't start. Please try again.");
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (!sourceSession.active) { await reader.cancel(); return null; }
        if (done) break;
        buffer += value;
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const line = chunk.split("\n").find(entry => entry.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6));
          if (event.operation) { latestOperation = observeOperation(event.operation); if (latestOperation) await rememberSources(latestOperation); }
          switch (event.type) {
            case "operation": break;
            case "text": update(replyId, turn => ({ ...turn, text: turn.text + event.delta })); break;
            case "status": activity({ kind: "note", label: event.message, done: false }, "status"); break;
            case "file_start": activity({ kind: "file", label: `${event.op === "edit" ? "Editing" : "Writing"} ${event.path}`, done: false }, `file:${event.path}`); break;
            case "file":
              touched.add(event.path);
              live.files = { ...live.files, [event.path]: event.content };
              onLive({ ...live, building: true });
              activity({ kind: "file", label: `${event.op === "edit" ? "Edited" : "Wrote"} ${event.path}`, done: true }, `file:${event.path}`);
              break;
            case "delete": {
              touched.add(event.path);
              const next = { ...live.files }; delete next[event.path]; live.files = next;
              onLive({ ...live, building: true });
              activity({ kind: "file", label: `Removed ${event.path}`, done: true }, `file:${event.path}`);
              break;
            }
            case "image_start": activity({ kind: "image", label: `Creating image: ${event.name}`, done: false }, `image:${event.name}`); break;
            case "image":
              live.assets = [...live.assets.filter(asset => asset.path !== event.path), { id: event.assetId, path: event.path }];
              onLive({ ...live, building: true });
              activity({ kind: "image", label: `Created ${event.url}`, done: true }, `image:${String(event.path).replace(/^public\/images\/|\.webp$/g, "")}`);
              break;
            case "document":
              live.document = event.document; live.focus = event.focus;
              onLive({ ...live, building: true });
              break;
            case "item_start": activity({ kind: "file", label: event.label, done: false }, `item:${event.key}`); break;
            case "item": activity({ kind: "file", label: event.label, done: true }, `item:${event.key}`); break;
            case "tool_error": activity({ kind: "note", label: "Fixing an issue…", done: true }); break;
            case "usage": update(replyId, turn => ({ ...turn, credits: event.credits })); break;
            case "done":
              finished = true;
              result = { version: Number(event.version), changed: event.changed !== false, touched: touched.size, finished: event.finished !== false,
                ...(latestOperation ? { operation: latestOperation } : {}) };
              update(replyId, turn => ({ ...turn, state: "done", text: turn.text.trim() ? `${turn.text.trim()}\n\n${event.summary}` : event.summary, credits: event.charged,
                activity: turn.activity.filter(item => item.id !== "status") }));
              break;
            case "error":
              finished = true;
              update(replyId, turn => ({ ...turn, state: "error", text: `${turn.text.trim() ? `${turn.text.trim()}\n\n` : ""}${event.message}`, activity: turn.activity.filter(item => item.id !== "status") }));
              break;
          }
        }
      }
      if (!finished) {
        await refreshOperation().catch(() => null);
        update(replyId, turn => ({ ...turn, state: "error", text: `${turn.text}\n\nThe connection closed early. Check the saved result and recorded charge below before sending the same request again.` }));
      }
    } catch (error) {
      if (!finished) await refreshOperation().catch(() => null);
      update(replyId, turn => ({ ...turn, state: "error", text: error instanceof Error ? error.message : "Something went wrong." }));
    }
    return result;
  }, [accountId, artifactId, observeOperation, onLive, refreshOperation, sourceContext, sourceOwner, sourceSession, workspaceId]);

  /** One visual review round: render the saved version at desktop and mobile
   * sizes, show the screenshots, and let the builder fix what it sees. */
  const reviewRound = useCallback(async (base: { version: number; round: number; effort: EffortLevel; operation?: OperationSnapshot }, live: Live): Promise<RunResult | null> => {
    const reply: Turn = { id: newId(), role: "assistant", text: "", review: true, state: "streaming",
      activity: [{ id: "capture", kind: "note", label: "Capturing desktop and mobile screenshots…", done: false }] };
    setTurns(current => [...current, reply]);
    onLive({ ...live, building: false });
    let capture;
    try {
      capture = await captureDesign(live.files, await assetDataUrls(live.assets, { accountId, workspaceId, artifactId }), undefined,
        () => update(reply.id, turn => ({ ...turn, activity: [{ id: "capture", kind: "note", label: "Waiting for you to return to this tab to take screenshots…", done: false }] })));
    } catch (error) {
      update(reply.id, turn => ({ ...turn, state: "error", activity: [], text: `The design review couldn't capture the page: ${error instanceof Error ? error.message : "unknown error"}. No credits were used.` }));
      return null;
    }
    if (!sourceSession.active) return null;
    const { screenshots, viewports, errors } = capture;
    const coverageIssue = reviewCoverageIssue(capture);
    if (coverageIssue) {
      update(reply.id, turn => ({ ...turn, state: "error", activity: [], text: `${coverageIssue} No review credits were used.` }));
      return null;
    }
    update(reply.id, turn => ({ ...turn,
      shots: screenshots.map(shot => ({ label: `${shot.viewport === "desktop" ? "Desktop" : "Mobile"} ${shot.index + 1}/${shot.of}`, url: `data:${shot.mediaType};base64,${shot.data}`, viewport: shot.viewport })),
      activity: [{ id: "capture", kind: "note", done: true,
        label: `Captured ${screenshots.length} screenshot${screenshots.length === 1 ? "" : "s"}${errors.length ? ` · ${errors.length} runtime error${errors.length === 1 ? "" : "s"}` : ""}` }] }));
    return stream({ expectedVersion: base.version, message: "Design review", effort: base.effort, mode: "review",
      operation: base.operation ? { id: base.operation.id, stepKey: newId(), kind: "review" } : beginOperation(),
      review: { round: base.round, screenshots, viewports, errors } }, reply.id, live);
  }, [accountId, artifactId, beginOperation, onLive, sourceSession, stream, workspaceId]);

  const finishRun = useCallback(async () => {
    setBusy(false);
    refreshBalance();
    try { await onSaved(); onLive(null); }
    catch { setNotice("The project list could not refresh. Your recorded result and charge can be checked below; refreshing does not start another generation."); }
  }, [onLive, onSaved, refreshBalance]);

  const send = useCallback(async (text: string, files: Attachment[] = [], options?: { plan?: SitePlan; effort?: EffortLevel; operation?: OperationSnapshot; sourceFiles?: StoredAttachment[] }) => {
    if (!text.trim() || busy || disabled || operationRunning || previewingRecovery) return;
    setBusy(true); setNotice(""); setDraft("");
    const userTurn: Turn = { id: newId(), role: "user", text: text.trim() + (files.length ? `\n📎 ${files.map(file => file.name).join(", ")}` : ""), activity: [], state: "done" };
    const reply: Turn = { id: newId(), role: "assistant", text: "", activity: [], state: "streaming" };
    setTurns(current => [...current, userTurn, reply]);
    const live: Live = { files: { ...baseFiles }, assets: [...baseAssets], document: baseDocument };
    onLive({ ...live, building: true });
    try {
      const level = options?.effort ?? effort;
      const requestOperation: OperationRequest = options?.operation ? { id: options.operation.id, stepKey: newId(), kind: "continuation" } : beginOperation();
      if ("actionKey" in requestOperation) await retainBuilderAttachmentSnapshot(sourceOwner, sourceContext, requestOperation.actionKey, options?.sourceFiles ?? []);
      if (!sourceSession.active) return;
      let result = await stream({ expectedVersion: version, message: text.trim(), effort: level,
        operation: requestOperation,
        attachments: files.map(({ name, mediaType, data }) => ({ name, mediaType, data })), ...(options?.plan ? { plan: options.plan } : {}) }, reply.id, live);
      if (result && options?.plan) planner.markBuilt(options.plan);
      // A run cut off by the platform time limit saves its progress; pick up
      // where it stopped in a fresh request instead of asking the user to.
      let touched = result?.touched ?? 0;
      for (let attempt = 0; attempt < MAX_CONTINUATIONS && result?.changed && !result.finished && result.operation && result.operation.remainingCredits > 0; attempt++) {
        const next: Turn = { id: newId(), role: "assistant", text: "", activity: [{ id: "status", kind: "note", label: "Continuing where I left off…", done: false }], state: "streaming" };
        setTurns(current => [...current, next]);
        refreshBalance();
        const continued: RunResult | null = await stream({ expectedVersion: result.version, effort: level,
          operation: { id: result.operation.id, stepKey: newId(), kind: "continuation" },
          attachments: files,
          message: `Continue the previous request and complete everything that is still missing, then check the project and call finish. The previous request was:
${text.trim().slice(0, 6000)}` }, next.id, live);
        if (!continued) break;
        touched += continued.touched;
        result = continued;
      }
      // First builds and large changes get an automatic look-and-fix pass.
      const rounds = result?.changed && website ? autoReviewRounds(level, { firstBuild: !Object.keys(baseFiles).length, filesTouched: touched }) : 0;
      for (let round = 1; round <= rounds && result?.changed && result.operation && result.operation.remainingCredits > 0; round++) {
        refreshBalance();
        result = await reviewRound({ version: result.version, round, effort: level, operation: result.operation }, live);
      }
      // The final repair invalidates earlier screenshots. Re-render its result
      // without another model call rather than presenting pre-fix images as proof.
      if (rounds > 0 && result?.changed) {
        onLive({ ...live, building: false });
        const check: Turn = { id: newId(), role: "assistant", text: "", review: true, state: "streaming",
          activity: [{ id: "final-render", kind: "note", label: "Checking the final desktop and mobile render…", done: false }] };
        setTurns(current => [...current, check]);
        try {
          const capture = await captureDesign(live.files, await assetDataUrls(live.assets, { accountId, workspaceId, artifactId }));
          const issue = reviewCoverageIssue(capture);
          const hasDiagnostics = capture.errors.length > 0 || capture.viewports.some(view => view.overflowX > 1 || view.brokenImages.length > 0 || view.missingAlt > 0);
          const incomplete = issue || hasDiagnostics || !result.finished;
          update(check.id, turn => ({ ...turn, state: incomplete ? "error" : "done", activity: [], credits: 0,
            shots: capture.screenshots.map(shot => ({ label: `${shot.viewport === "desktop" ? "Desktop" : "Mobile"} ${shot.index + 1}/${shot.of}`, url: `data:${shot.mediaType};base64,${shot.data}`, viewport: shot.viewport })),
            text: incomplete ? `Your changes are saved. ${issue || "The final check still needs attention."} No credits were used for this capture.`
              : "Captured the updated desktop and mobile views. No runtime errors, broken images or horizontal overflow were detected. This capture used no credits." }));
        } catch {
          update(check.id, turn => ({ ...turn, state: "error", activity: [], credits: 0,
            text: "Your changes are saved, but the final render could not be captured. No credits were used for this capture." }));
        }
      }
    } catch (error) {
      if (sourceSession.active) { setNotice(error instanceof Error ? error.message : "The sources could not be retained."); setDraft(text); }
    } finally {
      if (sourceSession.active) await finishRun();
    }
  }, [accountId, artifactId, baseAssets, baseDocument, baseFiles, beginOperation, busy, disabled, effort, finishRun, onLive, operationRunning, planner, previewingRecovery, refreshBalance, reviewRound, sourceContext, sourceOwner, sourceSession, stream, version, website, workspaceId]);

  /** Manual "Review design" for the current saved version. */
  const review = useCallback(async () => {
    if (busy || disabled || operationRunning || previewingRecovery || !Object.keys(baseFiles).length) return;
    setBusy(true); setNotice("");
    setTurns(current => [...current, { id: newId(), role: "user", text: "Review the design", activity: [], state: "done" }]);
    try { await reviewRound({ version, round: 1, effort }, { files: { ...baseFiles }, assets: [...baseAssets] }); }
    finally { await finishRun(); }
  }, [baseAssets, baseFiles, busy, disabled, effort, finishRun, operationRunning, previewingRecovery, reviewRound, version]);

  /** Plan mode: investigate and propose an editable plan; never writes code.
   * A message while a draft plan is open revises that plan. */
  const plan = useCallback(async (text: string, files: Attachment[] = []) => {
    if (!text.trim() || busy || disabled || operationRunning || previewingRecovery) return;
    setBusy(true); setNotice(""); setDraft("");
    setMode("plan");
    const revise = draftPlan?.stored.plan ?? null;
    const userTurn: Turn = { id: newId(), role: "user", text: text.trim() + (files.length ? `\n📎 ${files.map(file => file.name).join(", ")}` : ""), activity: [], state: "done" };
    const reply: Turn = { id: newId(), role: "assistant", text: "", activity: [{ id: "status", kind: "note", label: revise ? "Revising the plan…" : "Planning…", done: false }], state: "streaming", plan: true };
    setTurns(current => [...current, userTurn, reply]);
    await planner.run({ turnId: reply.id, message: text.trim(), effort, expectedVersion: version, revise,
      attachments: files.map(({ name, mediaType, data }) => ({ name, mediaType, data })) }, {
      onText: delta => update(reply.id, turn => ({ ...turn, text: turn.text + delta })),
      onStatus: message => update(reply.id, turn => ({ ...turn, activity: [{ id: "status", kind: "note", label: message, done: false }] })),
      onCredits: credits => update(reply.id, turn => ({ ...turn, credits })),
      onPlan: active => update(reply.id, turn => ({ ...turn, plan: { title: active.stored.plan.title, revision: active.stored.revision } })),
      onDone: charged => update(reply.id, turn => ({ ...turn, state: "done", credits: charged, activity: [] })),
      onError: message => update(reply.id, turn => ({ ...turn, state: "error", plan: undefined, text: `${turn.text.trim() ? `${turn.text.trim()}\n\n` : ""}${message}`, activity: [] })),
    });
    setBusy(false);
    refreshBalance();
  }, [busy, disabled, draftPlan, effort, operationRunning, planner, previewingRecovery, refreshBalance, version]);
  const submitSources = useCallback(async (text: string, requestMode: "create" | "plan", options?: { plan?: SitePlan; effort?: EffortLevel }) => {
    if (!text.trim() || busy || disabled || operationRunning || previewingRecovery || sourceLock.current) return;
    if (!sources.ready || sources.busy) { setNotice("Wait for your source files to finish loading or saving."); return; }
    sourceLock.current = true; setPreparingSources(true); setNotice("");
    const originals = sources.files;
    try {
      const files = await prepareBuilderAttachments(originals);
      if (!sourceSession.active) return;
      if (requestMode === "plan") await plan(text, files);
      else await send(text, files, { ...options, sourceFiles: originals });
    } catch (error) {
      if (sourceSession.active) { setNotice(error instanceof Error ? error.message : "The source files could not be read."); setDraft(text); }
    } finally {
      sourceLock.current = false;
      if (sourceSession.active) setPreparingSources(false);
    }
  }, [busy, disabled, operationRunning, plan, previewingRecovery, send, sourceSession, sources.busy, sources.files, sources.ready]);
  const submit = (text: string) => void submitSources(text, mode);
  const buildPlan = (approved: SitePlan, level: EffortLevel) => {
    setMode("create"); setEffort(level);
    void submitSources(`Build the approved plan: ${approved.title}`, "create", { plan: approved, effort: level });
  };
  const revisePlan = () => { setMode("plan"); composer.current?.focus(); };
  const continueOperation = async () => {
    if (!operation || busy || disabled || authorizing.current || !operation.canContinue || operation.kind !== "build") return;
    authorizing.current = true; setBusy(true); setNotice("");
    try {
      // A continuation uses its retained original files, even after selection edits or reload.
      if (buildActionKey) await bindBuilderAttachmentSnapshot(sourceOwner, sourceContext, buildActionKey, operation.id);
      const files = operation.pendingKind === "review" ? [] : await prepareBuilderAttachments(await readBuilderAttachmentSnapshot(sourceOwner, sourceContext, operation.id));
      if (!sourceSession.active) return;
      const approved = await authorizeOperation(operation);
      if (!sourceSession.active) return;
      setBusy(false);
      if (approved.pendingKind === "review") {
        setBusy(true);
        try { await reviewRound({ version, round: 1, effort: approved.effort, operation: approved }, { files: { ...baseFiles }, assets: [...baseAssets] }); }
        finally { await finishRun(); }
      } else await send("Continue the saved request and finish the remaining work.", files, { effort: approved.effort, operation: approved });
    } catch (error) {
      await refreshOperation().catch(() => null);
      setNotice(error instanceof Error ? error.message : "The additional allowance could not be confirmed.");
      setBusy(false);
    } finally { authorizing.current = false; }
  };
  const previewRecovery = () => {
    if (!buildRecovery || busy || disabled) return;
    try {
      onLive({ ...recoveryPreview(buildRecovery.candidate, kind), building: false });
      setPreviewingRecovery({ runId: buildRecovery.runId, version });
      setNotice("Previewing the retained draft. The current saved version is unchanged. Choose Save reviewed draft or Return to saved version.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "The retained draft could not be previewed."); }
  };
  const saveRecovery = async () => {
    if (!buildOperation || !buildRecovery || previewingRecovery?.runId !== buildRecovery.runId || previewingRecovery.version !== version || busy || disabled || authorizing.current) return;
    authorizing.current = true; setBusy(true);
    try {
      await recoverOperation(buildOperation, buildRecovery.runId, version);
      await onSaved(); onLive(null); setPreviewingRecovery(null); refreshBalance();
      setNotice("Saved the reviewed draft as a new version. No additional generation credits were used.");
    } catch (error) {
      await refreshOperation().catch(() => null);
      setNotice(error instanceof Error ? error.message : "The recovery result needs to be checked before retrying.");
    } finally { authorizing.current = false; setBusy(false); }
  };
  const saveRecoveredPlan = async () => {
    if (busy || disabled || authorizing.current || !planner.recoverablePlan) return;
    authorizing.current = true; setBusy(true);
    try {
      const saved = await planner.recoverPlan(version);
      if (!saved?.result?.persisted) throw new Error("The retained plan was not confirmed as saved. Check its status before trying again.");
      setNotice("Saved the retained plan. No additional generation credits were used."); refreshBalance();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The plan recovery needs to be checked."); }
    finally { authorizing.current = false; setBusy(false); }
  };
  const planCard = (active: NonNullable<typeof planner.active>) => <PlanCard key={`${active.turnId}:${active.stored.revision}`} plan={active.stored.plan} estimate={active.estimate} recommended={active.recommended}
    revision={active.stored.revision} built={active.stored.status === "built"} save={active.save} busy={busy || preparingSources || !sources.ready || sources.busy || disabled || operationRunning || Boolean(previewingRecovery)}
    onChange={planner.edit} onBuild={buildPlan} onRevise={revisePlan} />;

  useEffect(() => {
    if (!autoStart || started.current || disabled || !sources.ready || sources.busy || turns.length || version > 1 || !operationReady || !planner.ready || hasPreviousOperation || planner.hasPrevious) return;
    started.current = true;
    void submitSources(autoStart, autoStartMode === "plan" && website ? "plan" : "create");
  }, [autoStart, autoStartMode, disabled, hasPreviousOperation, operationReady, planner.hasPrevious, planner.ready, sources.busy, sources.ready, submitSources, turns.length, version, website]);


  const empty = !turns.length && !history.length && !planner.restored;
  const canReview = website && Object.keys(baseFiles).length > 0;
  return <aside className="lb" aria-label="Builder chat">
    <div className="lb-log" ref={log} aria-live="polite">
      {empty && <div className="lb-intro"><Sparkles size={18} /><h3>{copy.title}</h3><p>{copy.intro}</p></div>}
      {!!history.length && <details className="lb-history"><summary>{history.length} earlier change{history.length === 1 ? "" : "s"}</summary>
        <ol>{history.map(item => <li key={item.number}><strong>v{item.number}</strong> {item.summary}</li>)}</ol></details>}
      {planner.restored && <div className="lb-turn lb-assistant">
        {planner.active?.turnId === planner.restored.turnId ? <><p>Here is the plan we left off with. Edit anything, reply to revise it, or build it.</p>{planCard(planner.active)}</>
          : <div className="pc pc-collapsed"><ListChecks size={14} /><span>Earlier plan · <strong>{planner.restored.stored.plan.title}</strong> — revised below</span></div>}
      </div>}
      {turns.map(turn => <div key={turn.id} className={`lb-turn lb-${turn.role}`} data-state={turn.state} data-review={turn.review || undefined}>
        {turn.review && <p className="lb-review-title"><Eye size={13} />{turn.state === "streaming" ? "Reviewing the design…" : "Design review"}</p>}
        {!!turn.shots?.length && <ul className="lb-shots" aria-label="Review screenshots">{turn.shots.map(shot =>
          // eslint-disable-next-line @next/next/no-img-element -- data URL screenshots, not optimisable
          <li key={shot.label} data-viewport={shot.viewport}><img src={shot.url} alt={`${shot.label} screenshot`} title={shot.label} /></li>)}</ul>}
        {turn.text && <p>{turn.text}</p>}
        {turn.plan && planner.active?.turnId === turn.id && planCard(planner.active)}
        {typeof turn.plan === "object" && planner.active?.turnId !== turn.id && <div className="pc pc-collapsed"><ListChecks size={14} /><span>Plan v{turn.plan.revision} · <strong>{turn.plan.title}</strong> — revised below</span></div>}
        {!!turn.activity.length && <ul className="lb-activity">{turn.activity.map(item => <li key={item.id} data-done={item.done}>
          {item.done ? <Check size={13} /> : <Loader2 size={13} className="lb-spin" />}
          {item.kind === "image" ? <ImageIcon size={13} /> : item.kind === "file" ? <FileCode2 size={13} /> : null}
          <span>{item.label}</span></li>)}</ul>}
        {turn.role === "assistant" && !turn.review && turn.state === "streaming" && !turn.text && !turn.activity.length && <p className="lb-thinking"><Loader2 size={14} className="lb-spin" /> Thinking…</p>}
        {turn.role === "assistant" && typeof turn.credits === "number" && turn.credits > 0 && <small className="lb-cost">{turn.state === "streaming" ? `${turn.credits} credits so far` : `${turn.credits} credits`}</small>}
      </div>)}
    </div>
    {(operation || recoveryNotice || previewingRecovery) && <section className="lb-operation" aria-label="Request allowance">
      {operation && <><div className="lb-operation-total"><strong>{operation.chargedCredits} / {operation.authorizedCredits} credits</strong><span>{operation.reservedCredits > 0 ? `${operation.reservedCredits} reserved` : "Total request maximum"}</span></div>
        <p>This allowance covers the request and its automatic refinements.</p></>}
      {recoveryNotice && <p role="status">{recoveryNotice}</p>}
      {mode === "plan" && planner.recoverablePlan && <div className="lb-operation-consent">
        <details className="lb-retained-plan"><summary>Review retained plan · {planner.recoverablePlan.stored.plan.title}</summary>
          <p>{planner.recoverablePlan.stored.plan.summary}</p><dl><dt>Goal</dt><dd>{planner.recoverablePlan.stored.plan.goal}</dd><dt>Audience</dt><dd>{planner.recoverablePlan.stored.plan.audience}</dd><dt>Positioning</dt><dd>{planner.recoverablePlan.stored.plan.positioning}</dd></dl>
          {planner.recoverablePlan.stored.plan.pages.map(page => <details key={page.path}><summary>{page.name} · {page.path}</summary><p>{page.purpose}</p>{page.sections.map((section, index) => <section key={index}><strong>{section.name}</strong><p>{section.purpose}</p><p>{section.content}</p></section>)}</details>)}
          <p><strong>Design direction:</strong> {planner.recoverablePlan.stored.plan.design.concept}</p><p>{planner.recoverablePlan.stored.plan.design.typography.display} + {planner.recoverablePlan.stored.plan.design.typography.body}</p>
          <ul>{planner.recoverablePlan.stored.plan.design.palette.map(color => <li key={color.name}>{color.name} · {color.hex} · {color.role}</li>)}</ul>
          <p>{planner.recoverablePlan.stored.plan.design.layout.join(" · ")}</p><p>{planner.recoverablePlan.stored.plan.design.imagery}</p><p>{planner.recoverablePlan.stored.plan.design.signatureInteraction}</p>
          {planner.recoverablePlan.stored.plan.changes.map((change, index) => <p key={index}>{change.change}</p>)}
          <ul>{[...planner.recoverablePlan.stored.plan.questions, ...planner.recoverablePlan.stored.plan.assumptions].map((text, index) => <li key={index}>{text}</li>)}</ul>
        </details>
        <p>Saving preserves this plan without another AI call. It does not build the website or overwrite newer local edits.</p>
        <button type="button" className="button small" disabled={busy || disabled || planner.checking} onClick={() => void saveRecoveredPlan()}>Save reviewed plan</button>
      </div>}
      {mode === "create" && buildRecovery && <div className="lb-operation-consent">
        <p>A retained draft is available. Previewing and saving it does not make another AI call. Saving adds a new version after checking that version {version} is still current.</p>
        {!previewingRecovery ? <button type="button" className="button small" disabled={busy || disabled} onClick={previewRecovery}>Preview retained draft</button>
          : <button type="button" className="button small" disabled={busy || disabled || previewingRecovery.version !== version} onClick={() => void saveRecovery()}>Save reviewed draft</button>}
      </div>}
      {previewingRecovery && <button type="button" className="lb-operation-check" disabled={busy} onClick={() => { onLive(null); setPreviewingRecovery(null); setNotice(""); }}>Return to saved version</button>}
      {operation?.kind === "build" && operation.canContinue && operation.status !== "running" && operation.maximumAdditionalCredits > 0 && <div className="lb-operation-consent">
        <p>Add up to {operation.maximumAdditionalCredits} credits. The total maximum becomes {operation.authorizedCredits + operation.maximumAdditionalCredits} credits.</p>
        <button type="button" className="button small" disabled={busy || disabled || checkingOperation || Boolean(previewingRecovery)} onClick={() => void continueOperation()}>Approve allowance & continue</button>
      </div>}
      <button type="button" className="lb-operation-check" disabled={busy || checkingOperation} onClick={() => void checkCurrentOperation().then(() => onSaved()).catch(() => setNotice("The saved result could not be refreshed. Try checking again."))}>{checkingOperation ? "Checking…" : "Check saved result & charge"}</button>
    </section>}
    <form className="lb-composer" data-mode={mode} onSubmit={event => { event.preventDefault(); submit(draft); }}>
      {mode === "plan" && <p className="lb-plan-note"><ListChecks size={12} />{draftPlan ? "Plan mode — your reply revises the plan above." : "Plan mode — I'll study your project and propose a plan. No code is written."}</p>}
      {draftPlan && <p className="lb-plan-note">Building the approved plan uses the source files currently listed here. Review this selection if you changed files after planning.</p>}
      <AttachmentList files={sources.files} onRemove={id => void sources.remove(id)} disabled={busy || preparingSources || sources.busy || disabled || operationRunning} compact note="Saved on this device · sent to AI with each new request. Continuing uses the original request’s files." />
      <p className="lb-plan-note">AI sources: PNG, JPEG, WebP, GIF, PDF, TXT or Markdown · up to 5 files, 3 MB combined. Text: up to 200,000 characters.</p>
      {sources.error && <p className="lb-notice" role="alert">{sources.error}</p>}
      <textarea ref={composer} aria-label="Message the builder" placeholder={mode === "plan" ? draftPlan ? "Revise the plan — e.g. add a pricing page, warmer palette" : "What should we plan? Describe the site or the change" : empty ? copy.start : copy.edit} value={draft} rows={3} maxLength={8000} disabled={busy || preparingSources || !sources.ready || sources.busy || disabled || operationRunning || Boolean(previewingRecovery)}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(draft); } }} />
      <div className="lb-controls">
        {website && <div className="lb-mode" role="group" aria-label="Mode">
          <button type="button" aria-pressed={mode === "create"} disabled={busy || Boolean(previewingRecovery)} onClick={() => setMode("create")} title="Build: edit the website directly"><Hammer size={12} />Build</button>
          <button type="button" aria-pressed={mode === "plan"} disabled={busy || Boolean(previewingRecovery)} onClick={() => setMode("plan")} title="Plan: propose an editable plan first, no code"><ListChecks size={12} />Plan</button>
        </div>}
        <label className="lb-attach" aria-label="Attach files"><Paperclip size={15} /><input type="file" multiple accept={BUILDER_ATTACHMENT_ACCEPT} disabled={busy || preparingSources || !sources.ready || sources.busy || disabled || operationRunning || Boolean(previewingRecovery)} onChange={event => { void sources.add(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label>
        <select aria-label="Effort" value={effort} disabled={busy || operationRunning || Boolean(previewingRecovery)} onChange={event => setEffort(event.target.value as EffortLevel)} title={EFFORT_PRESENTATION[effort].purpose}>
          {EFFORT_LEVELS.map(level => <option key={level} value={level}>{EFFORT_PRESENTATION[level].label}</option>)}
        </select>
        {canReview && <button type="button" className="lb-review" aria-label={`Review design, up to ${reviewCreditCeiling(BUILDER_EFFORT[effort].ceilingCredits)} credits`} disabled={busy || preparingSources || !sources.ready || sources.busy || disabled || operationRunning || Boolean(previewingRecovery)} onClick={() => void review()} title="Look at the site on desktop and mobile and fix visual problems"><Eye size={14} />Review · {reviewCreditCeiling(BUILDER_EFFORT[effort].ceilingCredits)} max</button>}
        <span className="lb-balance">{balance ? balance.unlimited ? "Unlimited credits" : `${balance.available} credits` : ""}</span>
        <button type="submit" className="lb-send" aria-label={mode === "plan" ? "Plan" : "Send"} disabled={busy || preparingSources || !sources.ready || sources.busy || disabled || operationRunning || Boolean(previewingRecovery) || !draft.trim()}>{busy ? <Loader2 size={16} className="lb-spin" /> : <ArrowUp size={16} />}</button>
      </div>
      <p className="lb-limit">Up to {mode === "plan" ? PLAN_CEILING_CREDITS : BUILDER_EFFORT[effort].ceilingCredits} credits for this {mode === "plan" ? "plan" : "request, including automatic refinements"}.</p>
      {(notice || (disabled && disabledReason)) && <p className="lb-notice" role="status">{notice || disabledReason}</p>}
    </form>
  </aside>;
}
