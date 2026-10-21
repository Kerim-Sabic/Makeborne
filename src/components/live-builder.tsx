"use client";
import { affordability } from "@/lib/billing/affordability";

import { closeSheetOnEscape } from "@/lib/overlay-focus";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, Eye, FileCode2, Hammer, ImageIcon, ListChecks, Loader2, MessageSquare, Paperclip, ReceiptText, Sparkles, Square, TriangleAlert } from "lucide-react";
import { EFFORT_LEVELS, EFFORT_PRESENTATION, type EffortLevel } from "@/lib/routing/effort";
import type { SitePlan } from "@/lib/builder/plan";
import type { DocumentSource } from "@/lib/documents/schema";
import { captureDesign } from "@/lib/builder/design-capture";
import { autoReviewRounds, reviewCoverageIssue, reviewCreditCeiling } from "@/lib/builder/review-policy";
import { BUILDER_EFFORT } from "@/lib/builder/pricing";
import { PLAN_CEILING_CREDITS } from "@/lib/builder/plan";
import type { BuilderEstimates } from "@/lib/builder/credit-estimate";
import { meterEvent, meterLost, meterRefused, newRunMeter, runReceipt, formatDuration, type RunMeter, type RunReceipt } from "@/lib/builder/run-receipt";
import { readCloudImage } from "./cloud-api";
import PlanCard from "./plan-card";
import { usePlanMode } from "./use-plan-mode";
import { useBuilderOperation } from "./use-builder-operation";
import type { OperationRequest, OperationSnapshot } from "@/lib/builder/operation-contract";
import { recoveryPreview } from "@/lib/builder/recovery-preview";
import { CHECK_EFFECT, continueEffect, operationPhase, recoverEffect, stopEffect } from "@/lib/builder/action-semantics";
import { BUILDER_ATTACHMENT_ACCEPT, serializeBuilderRequest, prepareBuilderAttachments, type BuilderAttachment } from "@/lib/builder/attachments";
import { attachmentOwner, projectAttachmentKey, retainBuilderAttachmentSnapshot, bindBuilderAttachmentSnapshot, readBuilderAttachmentSnapshot, type Attachment as StoredAttachment } from "@/lib/attachments";
import { AttachmentList, useFileAttachments, useSourceReadiness } from "./file-attachments";
import { sourceIntentIssue } from "@/lib/builder/source-readiness";
import BriefQuestionsCard from "./brief-questions-card";
import { briefWithAnswers, designAnswers, isBriefQuestion, mergedQuestions, questionLimit, type BriefAnswers, type BriefQuestion, type DesignAnswers } from "@/lib/builder/brief-questions";
import EnhancedBriefCard, { buildRefusedToo, type EnhancingState } from "./enhanced-brief-card";
import { shouldEnhance, type BuildBrief } from "@/lib/builder/enhanced-brief";
import { clearPendingRequest, pendingRequestKey, planApprovalIdentity, readPendingRequest, savePendingRequest, targetIssue, targetReference, undoIssue, type EditTarget, type PendingRequest } from "@/lib/builder/edit-intent";
import { useUnsentDraft } from "./use-unsent-draft";
import UnsentDraftNotice from "./unsent-draft-notice";
import { provenanceLabel, type ProjectProvenance } from "@/lib/experts/advisor-brief";
import responsive from "../../infra/project-runtime/responsive-images.cjs";

type Activity = { id: string; kind: "file" | "image" | "note" | "error"; label: string; done: boolean };
type Shot = { label: string; url: string; viewport: string };
type Turn = { id: string; role: "user" | "assistant"; text: string; activity: Activity[]; state: "streaming" | "done" | "error"; credits?: number; plan?: { title: string; revision: number } | true; review?: boolean; shots?: Shot[]; receipt?: RunReceipt; enhancedBrief?: BuildBrief };
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
function browserStorage() { try { return window.localStorage; } catch { return null; } }
/** How a request ended, so its text and approval identity are kept only while the outcome is unknown. */
type Outcome = "done" | "refused" | "uncertain";
const short = (text: string) => text.length > 90 ? `${text.slice(0, 88).trimEnd()}…` : text;

/** What one request cost and did, from the server's settled charges and the checks that ran. */
function Receipt({ receipt, kind }: { receipt: RunReceipt; kind: "website" | "book" | "presentation" }) {
  const changes = kind === "website" ? receipt.files : receipt.items;
  const noun = kind === "website" ? "file" : "change";
  return <section className="lb-receipt" aria-label="Request receipt">
    <p className="lb-receipt-title"><ReceiptText size={13} />Receipt</p>
    <dl>
      <div><dt>Charged</dt><dd>{receipt.charged === null ? "Being confirmed. Use Check saved result & charge below." : `${receipt.charged} credit${receipt.charged === 1 ? "" : "s"}${receipt.unlimited ? " · unlimited allowance" : ""}`}</dd></div>
      <div><dt>Result</dt><dd>{receipt.saved ? receipt.version ? `Saved as version ${receipt.version}` : "Saved" : "No new version"}</dd></div>
      <div><dt>Time</dt><dd>{formatDuration(receipt.durationMs)}</dd></div>
      <div><dt>Sources sent</dt><dd>{receipt.sources.length ? receipt.sources.join(", ") : "None"}</dd></div>
      {receipt.brief && <div><dt>Brief</dt><dd>From {receipt.brief}</dd></div>}
      {receipt.concept && <div><dt>Concept</dt><dd>{receipt.concept.chosen}{receipt.concept.runnersUp.length ? ` · also considered: ${receipt.concept.runnersUp.join(", ")}` : ""}</dd></div>}
      {receipt.enhanced && <div><dt>{receipt.brief ? "Brief used" : "Brief"}</dt><dd>{receipt.enhanced.mode === "original" ? "Your own words" : receipt.enhanced.mode === "analysis" ? "Your own words, with a brief analysis" : receipt.enhanced.mode === "edited" ? "Enhanced brief, with your edits" : "Enhanced brief"}{receipt.enhanced.mode === "original" ? "" : " · reading your brief was free"}</dd></div>}
      <div><dt>{kind === "website" ? "Files changed" : "Changes"}</dt><dd>{changes.length ? <details><summary>{changes.length} {noun}{changes.length === 1 ? "" : "s"}</summary><ul>{changes.slice(0, 40).map(item => <li key={item}>{item}</li>)}{changes.length > 40 && <li>and {changes.length - 40} more</li>}</ul></details> : "None"}</dd></div>
    </dl>
    {!!receipt.checks.length && <ul className="lb-receipt-checks">{receipt.checks.map(check => <li key={check.label} data-ok={check.ok}>{check.ok ? <Check size={13} aria-label="Passed" /> : <TriangleAlert size={13} aria-label="Needs attention" />}<span>{check.label}</span></li>)}</ul>}
    {receipt.notCharged && <p className="lb-receipt-note">Nothing was saved, and this request was not charged.</p>}
  </section>;
}
/** Follow-up runs after a time-limited run saved partial progress. */
const MAX_CONTINUATIONS = 2;

/** Project images as data URLs keyed by their in-code path (/images/x.webp),
 * so the sandboxed capture frame needs no network access. */
async function assetDataUrls(assets: Live["assets"], scope: { accountId: string; workspaceId: string; artifactId: string }): Promise<Record<string, string>> {
  const controller = new AbortController();
  // Responsive copies (srcset) are for the published site; captures use the originals.
  const entries = await Promise.all(assets.filter(asset => !responsive.isVariantPath(asset.path)).map(async asset => {
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
export default function LiveBuilder({ accountId, workspaceId, artifactId, version, history, baseFiles, baseAssets, defaultEffort, disabled, disabledReason, autoStart, autoStartMode, prefill, provenance = null, onProvenance, onLive, onSaved, onUndo, undoBlocked = null, brandKit, kind = "website", baseDocument, estimates = null }: {
  accountId: string; workspaceId: string; artifactId: string; version: number;
  /** Text placed in the composer for the user to review, e.g. client feedback or an advisor brief (with its mode and effort). Never sent automatically. */
  prefill?: { key: string; text: string; target?: EditTarget; mode?: "create" | "plan"; effort?: EffortLevel } | null;
  /** The advisor brief this project was handed: pending until the next new request records it, then sent. */
  provenance?: ProjectProvenance | null;
  onProvenance?: (next: ProjectProvenance | null) => void;
  /** Restores `from` as a new version after checking `to` is still current. Returns why it could not, or null. Never deletes history or publishes. */
  onUndo?: (change: { from: number; to: number }) => string | null;
  /** Why Undo must wait (unsaved draft, save in progress, conflict). */
  undoBlocked?: string | null;
  /** The brand kit the next request will use: its name, null for none, undefined while unknown. */
  brandKit?: string | null;
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
  /** Measured credit ranges from GET /api/build, shown before a first build. */
  estimates?: BuilderEstimates | null;
}) {
  const copy = COPY[kind], website = kind === "website";
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [effort, setEffort] = useState<EffortLevel>(defaultEffort ?? "medium");
  const sourceOwner = attachmentOwner(accountId);
  const sourceContext = projectAttachmentKey(`${accountId}:${workspaceId}:${artifactId}`);
  const sources = useFileAttachments(sourceOwner, sourceContext);
  // Per-request choice: a left-out file stays saved for the project but is not sent.
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(() => new Set());
  const readiness = useSourceReadiness(sources.files, leftOut);
  const settleSources = readiness.settle;
  const [preparingSources, setPreparingSources] = useState(false);
  const sourceLock = useRef(false);
  const sourceSession = useMemo(() => ({ active: true, accountId, workspaceId, artifactId }), [accountId, workspaceId, artifactId]);
  useEffect(() => { sourceSession.active = true; return () => { sourceSession.active = false; }; }, [sourceSession]);
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [balance, setBalance] = useState<{ available: number; unlimited: boolean } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);
  // Questions before the first build, asked once per project session.
  const [asking, setAsking] = useState<{ text: string; mode: "create" | "plan"; questions: readonly BriefQuestion[] | null } | null>(null);
  const asked = useRef(false);
  /** The enhanced-brief step of a first website build: shown before anything paid starts (M08). */
  const [enhancing, setEnhancing] = useState<{ text: string; design: DesignAnswers; state: EnhancingState } | null>(null);
  const enhanceAbort = useRef<AbortController | null>(null);
  /** A detailed first brief being analysed (free, automatic; Skip starts without it). */
  const [analyzing, setAnalyzing] = useState<{ text: string; design: DesignAnswers } | null>(null);
  const authorizing = useRef(false);
  const [previewingRecovery, setPreviewingRecovery] = useState<{ runId: string; version: number } | null>(null);
  const [chosenMode, setMode] = useState<"create" | "plan" | null>(null);
  const planner = usePlanMode({ accountId, workspaceId, artifactId });
  const { actionKey: buildActionKey, operation: buildOperation, recovery: buildRecovery, checking: checkingBuildOperation, recoveryNotice: buildRecoveryNotice, ready: operationReady, hasPrevious: hasPreviousOperation,
    begin: beginOperation, observe: observeOperation, refresh: refreshOperation, authorize: authorizeOperation, recover: recoverOperation, cancel: cancelBuild, cancelling: cancellingBuild, pendingCancel: buildPendingCancel } = useBuilderOperation({ accountId, workspaceId, artifactId });
  // An open draft plan from an earlier session keeps the composer in Plan mode.
  const mode = !website ? "create" : chosenMode ?? (planner.restored ? "plan" : "create");
  const operation = mode === "plan" ? planner.operation : buildOperation;
  const checkingOperation = mode === "plan" ? planner.checking : checkingBuildOperation;
  const recoveryNotice = mode === "plan" ? planner.recoveryNotice : buildRecoveryNotice;
  const checkCurrentOperation = mode === "plan" ? planner.refreshOperation : refreshOperation;
  const operationRunning = buildOperation?.status === "running" || planner.operation?.status === "running" || buildPendingCancel || Boolean(planner.pendingCancel);
  const cancelling = mode === "plan" ? planner.cancelling : cancellingBuild;
  const pendingCancel = mode === "plan" ? planner.pendingCancel : buildPendingCancel;
  const stop = mode === "plan" ? planner.cancel : cancelBuild;
  const draftPlan = planner.active && planner.active.stored.status === "draft" ? planner.active : null;
  const [prefilled, setPrefilled] = useState<string | null>(null);
  // The element picked in the preview, bound to the saved file it was picked from.
  const [target, setTarget] = useState<EditTarget | null>(null);
  if (prefill && prefill.key !== prefilled) {
    setPrefilled(prefill.key); setDraft(prefill.text.slice(0, 8000)); setTarget(prefill.target ?? null);
    if (prefill.effort) setEffort(prefill.effort);
    if (website && prefill.mode) setMode(prefill.mode);
  }
  // A handed-over advisor brief is recorded with the next new request (build or plan), never with a continuation.
  const pendingBrief = provenance?.status === "pending" ? provenance : null;
  const briefSent = useCallback((used: ProjectProvenance) => { onProvenance?.({ ...used, status: "sent", sentAt: Date.now() }); }, [onProvenance]);
  // The composer's unsent text survives a reload for this account and project only; restoring never sends.
  const draftDefaults = useMemo(() => ({ kind, mode: "create" as const, effort: defaultEffort ?? "medium", text: "" }), [defaultEffort, kind]);
  const unsent = useUnsentDraft({ surface: `builder.${workspaceId}.${artifactId}`, account: { accountId }, enabled: true,
    fields: { kind, mode: website ? (chosenMode ?? "create") : "create", effort, text: draft }, defaults: draftDefaults,
    apply: fields => { setDraft(fields.text); setEffort(fields.effort); if (website) setMode(fields.mode); } });
  // A sent request's text stays on this device until its outcome is known.
  const pendingScope = useMemo(() => { try { return pendingRequestKey(accountId, workspaceId, artifactId); } catch { return null; } }, [accountId, workspaceId, artifactId]);
  const [inFlight, setInFlight] = useState<PendingRequest | null>(null);
  const [earlier, setEarlier] = useState<PendingRequest | null>(null);
  useEffect(() => {
    const found = pendingScope ? readPendingRequest(browserStorage(), pendingScope, Date.now()) : null;
    queueMicrotask(() => setEarlier(found));
  }, [pendingScope]);
  const lastRefusal = useRef<string | null>(null);
  // Firefox aborts in-flight requests as soon as a reload or navigation starts (before pagehide) and still runs
  // their failure handling. A request whose page is going away has an unknown outcome: its record must survive
  // for the next load. If a leave prompt is cancelled, the next key or pointer press clears the flag; until then an
  // unknown outcome is simply kept (the conservative side: the next load asks before anything is resent).
  const leavingPage = useRef(false);
  useEffect(() => {
    const leave = () => { leavingPage.current = true; }, stay = () => { leavingPage.current = false; };
    const leaving = ["beforeunload", "pagehide"] as const, staying = ["pageshow", "pointerdown", "keydown"] as const;
    leaving.forEach(type => window.addEventListener(type, leave)); staying.forEach(type => window.addEventListener(type, stay, true));
    return () => { leaving.forEach(type => window.removeEventListener(type, leave)); staying.forEach(type => window.removeEventListener(type, stay, true)); };
  }, []);
  const holdRequest = useCallback((request: PendingRequest, persist = true) => {
    setInFlight(request); setEarlier(null); lastRefusal.current = null;
    if (persist && pendingScope) savePendingRequest(browserStorage(), pendingScope, request);
  }, [pendingScope]);
  /** Ends the in-flight request; unless it finished, its text goes back in the composer (never sent again automatically).
   * A plan approval keeps no composer text: the plan card stays and its saved revision is the request. */
  const releaseRequest = useCallback((request: PendingRequest, outcome: Outcome, restore = true) => {
    if (leavingPage.current && outcome !== "done") return;
    setInFlight(null);
    if (pendingScope) clearPendingRequest(browserStorage(), pendingScope);
    if (outcome === "done" || !restore) return;
    setDraft(current => current.trim() ? current : request.text);
    setNotice(outcome === "refused" ? "Your request is back in the composer. Nothing was sent or charged for it."
      : "Your request is back in the composer. Check the saved result and charge below before sending it again.");
  }, [pendingScope]);
  // The version an AI change produced, so it can be undone as a new version.
  const [lastChange, setLastChange] = useState<{ from: number; to: number } | null>(null);
  const [undoing, setUndoing] = useState<{ from: number; to: number } | null>(null);
  const approvals = useRef(new Map<string, { actionKey: string; stepKey: string }>());
  // The source files included in the current request (the "Will be read" set at sending).
  const [sentSources, setSentSources] = useState<{ names: string[]; operationId: string | null } | null>(null);
  // After a reload, a build request's retained source snapshot still names its files.
  const [retainedSources, setRetainedSources] = useState<{ operationId: string; names: string[] } | null>(null);
  const buildOperationId = buildOperation?.id ?? null;
  useEffect(() => {
    if (!buildOperationId || sentSources) return;
    let current = true;
    readBuilderAttachmentSnapshot(sourceOwner, sourceContext, buildOperationId)
      .then(files => { if (current) setRetainedSources({ operationId: buildOperationId, names: files.map(file => file.name) }); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [buildOperationId, sentSources, sourceContext, sourceOwner]);
  const approvingRef = useRef(false);
  const [approving, setApproving] = useState(false);
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
  const stream = useCallback(async (payload: Record<string, unknown>, replyId: string, live: Live, meter?: RunMeter): Promise<RunResult | null> => {
    const activity = (item: Omit<Activity, "id">, key?: string) => update(replyId, turn => {
      const existing = key ? turn.activity.findIndex(entry => entry.id === key) : -1;
      if (existing >= 0) { const next = [...turn.activity]; next[existing] = { ...next[existing], ...item }; return { ...turn, activity: next }; }
      return { ...turn, activity: [...turn.activity, { id: key ?? newId(), ...item }] };
    });
    const touched = new Set<string>();
    let result: RunResult | null = null, finished = false, refused = false;
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
        // Refused before the step ran: the server settles a reserved step at zero.
        refused = true; lastRefusal.current = typeof failure?.error?.code === "string" ? failure.error.code : "REFUSED"; if (meter) meterRefused(meter);
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
          if (meter) meterEvent(meter, event);
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
        if (meter) meterLost(meter);
        await refreshOperation().catch(() => null);
        update(replyId, turn => ({ ...turn, state: "error", text: `${turn.text}\n\nThe connection closed early. Check the saved result and recorded charge below before sending the same request again.` }));
      }
    } catch (error) {
      if (!finished) { if (meter && !refused) meterLost(meter); await refreshOperation().catch(() => null); }
      update(replyId, turn => ({ ...turn, state: "error", text: error instanceof Error ? error.message : "Something went wrong." }));
    }
    return result;
  }, [accountId, artifactId, observeOperation, onLive, refreshOperation, sourceContext, sourceOwner, sourceSession, workspaceId]);

  /** One visual review round: render the saved version at desktop and mobile
   * sizes, show the screenshots, and let the builder fix what it sees. */
  const reviewRound = useCallback(async (base: { version: number; round: number; effort: EffortLevel; operation?: OperationSnapshot }, live: Live, meter?: RunMeter): Promise<RunResult | null> => {
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
    const reviewed = await stream({ expectedVersion: base.version, message: "Design review", effort: base.effort, mode: "review",
      operation: base.operation ? { id: base.operation.id, stepKey: newId(), kind: "review" } : beginOperation(),
      // A manual review is a new request: it carries the maximum shown on the Review button.
      ...(base.operation ? {} : { approvedMaximum: reviewCreditCeiling(BUILDER_EFFORT[base.effort].ceilingCredits) }),
      review: { round: base.round, screenshots, viewports, errors } }, reply.id, live, meter);
    if (reviewed && meter) meter.reviews++;
    return reviewed;
  }, [accountId, artifactId, beginOperation, onLive, sourceSession, stream, workspaceId]);

  const finishRun = useCallback(async () => {
    setBusy(false);
    refreshBalance();
    try { await onSaved(); onLive(null); }
    catch { setNotice("The project list could not refresh. Your recorded result and charge can be checked below; refreshing does not start another generation."); }
  }, [onLive, onSaved, refreshBalance]);

  /** A receipt in the conversation once a request ends: charge, changes, checks, time. */
  const unlimited = Boolean(balance?.unlimited);
  const addReceipt = useCallback((meter: RunMeter) => {
    const receipt = runReceipt(meter, { website, unlimited });
    if (receipt) setTurns(current => [...current, { id: newId(), role: "assistant", text: "", activity: [], state: "done", receipt }]);
  }, [unlimited, website]);

  const send = useCallback(async (text: string, files: Attachment[] = [], options?: { approvedMaximum?: number; plan?: SitePlan; planRevision?: number; approval?: { actionKey: string; stepKey: string }; effort?: EffortLevel; operation?: OperationSnapshot; sourceFiles?: StoredAttachment[]; target?: string; brief?: BuildBrief; design?: DesignAnswers; enhanced?: RunMeter["enhanced"] }): Promise<Outcome | undefined> => {
    if (!text.trim() || busy || disabled || operationRunning || previewingRecovery) return;
    const quoteIssue = !options?.operation ? affordability(options?.approvedMaximum ?? BUILDER_EFFORT[options?.effort ?? effort].ceilingCredits, balance) : null;
    if (quoteIssue) { setNotice(quoteIssue); return; }
    setBusy(true); setNotice(""); setDraft(""); setLastChange(null); setUndoing(null);
    // A continuation re-runs the saved request; only a new request holds its own text.
    const request: PendingRequest | null = options?.operation ? null : { text: text.trim(), mode: "create", baseVersion: version, ...(options?.target ? { target: options.target } : {}), sentAt: Date.now() };
    if (request) holdRequest(request, !options?.plan);
    let outcome: Outcome = "uncertain";
    const userTurn: Turn = { id: newId(), role: "user", text: text.trim() + (files.length ? `\n📎 ${files.map(file => file.name).join(", ")}` : ""), activity: [], state: "done", ...(options?.brief && !options.operation ? { enhancedBrief: options.brief } : {}) };
    const reply: Turn = { id: newId(), role: "assistant", text: "", activity: [], state: "streaming" };
    setTurns(current => [...current, userTurn, reply]);
    const live: Live = { files: { ...baseFiles }, assets: [...baseAssets], document: baseDocument };
    onLive({ ...live, building: true });
    const meter = newRunMeter();
    meter.sources = files.map(file => file.name);
    const brief = options?.operation ? null : pendingBrief;
    if (brief) meter.brief = provenanceLabel(brief.provenance);
    if (options?.enhanced && !options.operation) meter.enhanced = options.enhanced;
    setSentSources({ names: meter.sources, operationId: options?.operation?.id ?? null });
    try {
      const level = options?.effort ?? effort;
      const requestOperation: OperationRequest = options?.operation ? { id: options.operation.id, stepKey: newId(), kind: "continuation" } : beginOperation(options?.approval);
      if ("actionKey" in requestOperation) await retainBuilderAttachmentSnapshot(sourceOwner, sourceContext, requestOperation.actionKey, options?.sourceFiles ?? []);
      if (!sourceSession.active) return;
      let result = await stream({ expectedVersion: version, message: text.trim(), effort: level,
        operation: requestOperation,
        // A new request is bound to the maximum shown before sending (the composer limit or the plan approval).
        ...("actionKey" in requestOperation ? { approvedMaximum: options?.approvedMaximum ?? BUILDER_EFFORT[level].ceilingCredits } : {}),
        attachments: files.map(({ name, mediaType, data }) => ({ name, mediaType, data })), ...(options?.plan ? { plan: options.plan, planRevision: options.planRevision } : {}),
        ...(brief ? { provenance: brief.provenance } : {}),
        // The approved enhanced brief and the client's answers start the operation; later stages read them from it.
        ...("actionKey" in requestOperation && !options?.plan && options?.brief ? { brief: options.brief } : {}),
        // Design answers also bind an approved plan's build (the plan carries its own direction; the answers keep must-haves and imagery).
        ...("actionKey" in requestOperation && options?.design && Object.keys(options.design).length ? { design: options.design } : {}) }, reply.id, live, meter);
      outcome = result ? "done" : lastRefusal.current ? "refused" : "uncertain";
      if (brief && outcome === "done") briefSent(brief);
      if (request) releaseRequest(request, outcome, !options?.plan);
      if (outcome === "done" && options?.target) setTarget(null);
      let savedTo = result?.changed ? result.version : null;
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
${text.trim().slice(0, 6000)}` }, next.id, live, meter);
        if (!continued) break;
        touched += continued.touched;
        result = continued;
        if (continued.changed) savedTo = continued.version;
      }
      // First builds and large changes get an automatic look-and-fix pass.
      const rounds = result?.changed && website ? autoReviewRounds(level, { firstBuild: !Object.keys(baseFiles).length, filesTouched: touched }) : 0;
      for (let round = 1; round <= rounds && result?.changed && result.operation && result.operation.remainingCredits > 0; round++) {
        refreshBalance();
        result = await reviewRound({ version: result.version, round, effort: level, operation: result.operation }, live, meter);
        if (result?.changed) savedTo = result.version;
      }
      if (savedTo !== null && savedTo > version) setLastChange({ from: version, to: savedTo });
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
          meter.render = { ok: !issue && !hasDiagnostics };
          update(check.id, turn => ({ ...turn, state: incomplete ? "error" : "done", activity: [], credits: 0,
            shots: capture.screenshots.map(shot => ({ label: `${shot.viewport === "desktop" ? "Desktop" : "Mobile"} ${shot.index + 1}/${shot.of}`, url: `data:${shot.mediaType};base64,${shot.data}`, viewport: shot.viewport })),
            text: incomplete ? `Your changes are saved. ${issue || "The final check still needs attention."} No credits were used for this capture.`
              : "Captured the updated desktop and mobile views. No runtime errors, broken images or horizontal overflow were detected. This capture used no credits." }));
        } catch {
          meter.render = { ok: false };
          update(check.id, turn => ({ ...turn, state: "error", activity: [], credits: 0,
            text: "Your changes are saved, but the final render could not be captured. No credits were used for this capture." }));
        }
      }
    } catch (error) {
      if (sourceSession.active) {
        if (request) { setInFlight(null); if (pendingScope) clearPendingRequest(browserStorage(), pendingScope); }
        setNotice(error instanceof Error ? error.message : "The sources could not be retained."); setDraft(text);
      }
    } finally {
      if (sourceSession.active) { addReceipt(meter); await finishRun(); }
    }
    return outcome;
  }, [accountId, balance, addReceipt, artifactId, baseAssets, baseDocument, baseFiles, beginOperation, briefSent, busy, disabled, effort, finishRun, holdRequest, onLive, operationRunning, pendingBrief, pendingScope, planner, previewingRecovery, refreshBalance, releaseRequest, reviewRound, sourceContext, sourceOwner, sourceSession, stream, version, website, workspaceId]);

  /** Manual "Review design" for the current saved version. */
  const review = useCallback(async () => {
    if (busy || disabled || operationRunning || previewingRecovery || !Object.keys(baseFiles).length) return;
    const quoteIssue = affordability(reviewCreditCeiling(BUILDER_EFFORT[effort].ceilingCredits), balance);
    if (quoteIssue) { setNotice(quoteIssue); return; }
    setBusy(true); setNotice("");
    setTurns(current => [...current, { id: newId(), role: "user", text: "Review the design", activity: [], state: "done" }]);
    const meter = newRunMeter();
    try { await reviewRound({ version, round: 1, effort }, { files: { ...baseFiles }, assets: [...baseAssets] }, meter); }
    finally { if (sourceSession.active) addReceipt(meter); await finishRun(); }
  }, [addReceipt, balance, baseAssets, baseFiles, busy, disabled, effort, finishRun, operationRunning, previewingRecovery, reviewRound, sourceSession, version]);

  /** Plan mode: investigate and propose an editable plan; never writes code.
   * A message while a draft plan is open revises that plan. */
  const plan = useCallback(async (text: string, files: Attachment[] = []) => {
    if (!text.trim() || busy || disabled || operationRunning || previewingRecovery) return;
    const quoteIssue = affordability(PLAN_CEILING_CREDITS, balance);
    if (quoteIssue) { setNotice(quoteIssue); return; }
    setBusy(true); setNotice(""); setDraft("");
    setMode("plan");
    const revise = draftPlan?.stored.plan ?? null;
    const userTurn: Turn = { id: newId(), role: "user", text: text.trim() + (files.length ? `\n📎 ${files.map(file => file.name).join(", ")}` : ""), activity: [], state: "done" };
    const reply: Turn = { id: newId(), role: "assistant", text: "", activity: [{ id: "status", kind: "note", label: revise ? "Revising the plan…" : "Planning…", done: false }], state: "streaming", plan: true };
    setTurns(current => [...current, userTurn, reply]);
    const request: PendingRequest = { text: text.trim(), mode: "plan", baseVersion: version, sentAt: Date.now() };
    holdRequest(request);
    let ended = false;
    const end = (outcome: Outcome) => { if (!ended) { ended = true; releaseRequest(request, outcome); } };
    setSentSources({ names: files.map(file => file.name), operationId: null });
    const brief = pendingBrief;
    await planner.run({ turnId: reply.id, message: text.trim(), effort, expectedVersion: version, revise, approvedMaximum: PLAN_CEILING_CREDITS, ...(brief ? { provenance: brief.provenance } : {}),
      attachments: files.map(({ name, mediaType, data }) => ({ name, mediaType, data })) }, {
      onText: delta => update(reply.id, turn => ({ ...turn, text: turn.text + delta })),
      onStatus: message => update(reply.id, turn => ({ ...turn, activity: [{ id: "status", kind: "note", label: message, done: false }] })),
      onCredits: credits => update(reply.id, turn => ({ ...turn, credits })),
      onPlan: active => update(reply.id, turn => ({ ...turn, plan: { title: active.stored.plan.title, revision: active.stored.revision } })),
      onDone: charged => { end("done"); if (brief) briefSent(brief); update(reply.id, turn => ({ ...turn, state: "done", credits: charged, activity: [] })); },
      onError: message => { end("uncertain"); update(reply.id, turn => ({ ...turn, state: "error", plan: undefined, text: `${turn.text.trim() ? `${turn.text.trim()}\n\n` : ""}${message}`, activity: [] })); },
    });
    end("uncertain");
    setBusy(false);
    refreshBalance();
  }, [balance, briefSent, busy, disabled, draftPlan, effort, holdRequest, operationRunning, pendingBrief, planner, previewingRecovery, refreshBalance, releaseRequest, version]);
  const submitSources = useCallback(async (text: string, requestMode: "create" | "plan", options?: { approvedMaximum?: number; plan?: SitePlan; planRevision?: number; approval?: { actionKey: string; stepKey: string }; effort?: EffortLevel; target?: string; brief?: BuildBrief; design?: DesignAnswers; enhanced?: RunMeter["enhanced"] }): Promise<Outcome | undefined> => {
    if (!text.trim() || busy || disabled || operationRunning || previewingRecovery || sourceLock.current) return;
    if (!sources.ready || sources.busy) { setNotice("Wait for your source files to finish loading or saving."); return; }
    sourceLock.current = true; setPreparingSources(true); setNotice("");
    try {
      // Bind exactly the readable selection; unresolved files require an explicit
      // fix or Leave out decision. Duplicate references are still sent only once.
      const decided = await settleSources();
      const issue = sourceIntentIssue(decided);
      if (issue) throw new Error(issue);
      const originals = decided.ready;
      const files = await prepareBuilderAttachments(originals);
      if (!sourceSession.active) return;
      if (requestMode === "plan") await plan(text, files);
      else return await send(text, files, { ...options, sourceFiles: originals });
    } catch (error) {
      if (sourceSession.active) { setNotice(error instanceof Error ? error.message : "The source files could not be read."); setDraft(text); }
      return "refused";
    } finally {
      sourceLock.current = false;
      if (sourceSession.active) setPreparingSources(false);
    }
  }, [busy, disabled, operationRunning, plan, previewingRecovery, send, settleSources, sourceSession, sources.busy, sources.ready]);
  /** Questions written for this brief by a small, capped AI call (free to the user). Null on any failure. */
  const tailoredQuestions = useCallback(async (brief: string, attachments: number): Promise<readonly BriefQuestion[] | null> => {
    try {
      const response = await fetch("/api/build/questions", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(25_000),
        headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId },
        body: JSON.stringify({ workspaceId, artifactId, kind, brief: brief.slice(0, 8000), attachments: Math.min(attachments, 20) }) });
      if (!response.ok) return null;
      const value = await response.json() as { questions?: unknown };
      return Array.isArray(value.questions) && value.questions.every(isBriefQuestion) ? value.questions : null;
    } catch { return null; }
  }, [accountId, artifactId, kind, workspaceId]);
  /** The enhanced brief (short prompts) or the brief analysis (detailed ones) for a first website build: a small capped call,
   * free to the client. A failure carries the server's own message and whether a build would be refused for the same reason. */
  const enhanceBrief = useCallback(async (brief: string, design: DesignAnswers, signal: AbortSignal, original?: string): Promise<Exclude<EnhancingState, { status: "loading" }>> => {
    try {
      const response = await fetch("/api/build/enhance", { method: "POST", cache: "no-store", signal,
        headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId },
        body: JSON.stringify({ workspaceId, artifactId, brief: brief.slice(0, 8000), ...(original ? { original: original.slice(0, 8000) } : {}), ...(Object.keys(design).length ? { design } : {}), attachments: Math.min(sources.files.length, 20) }) });
      if (!response.ok) {
        const error = await response.json().then(value => (value as { error?: { code?: unknown; message?: unknown } }).error).catch(() => undefined);
        const code = typeof error?.code === "string" ? error.code : "", message = typeof error?.message === "string" && error.message.trim() ? error.message.trim().slice(0, 400) : undefined;
        return { status: "failed", message, blocking: buildRefusedToo(code) };
      }
      const value = await response.json() as { enhanced?: unknown; text?: unknown; charged?: unknown };
      if (!value.enhanced || typeof value.text !== "string" || !value.text.trim() || typeof value.charged !== "number") return { status: "failed" };
      return { status: "ready", enhanced: value.enhanced as Extract<EnhancingState, { status: "ready" }>["enhanced"], text: value.text, charged: value.charged };
    } catch { return { status: "failed" }; }
  }, [accountId, artifactId, sources.files.length, workspaceId]);
  /** After the questions: a first website build in Create mode shows its enhanced brief before starting; anything else starts as before. */
  // Deferred starts (after the free reading or the questions) use the latest effort, balance and sources, not the ones
  // captured when the questions appeared.
  const submitLatest = useRef(submitSources);
  useEffect(() => { submitLatest.current = submitSources; }, [submitSources]);
  /** The brief the questions took out of the composer goes back there whenever a start is refused, so nothing typed is lost. */
  const restoreBrief = useCallback((text: string, notice?: string) => {
    setDraft(text); asked.current = false;
    if (notice) setNotice(notice);
  }, []);
  /** A deferred start: a refusal (affordability, busy, sources not ready) returns the brief and answers to the composer. */
  const startDeferred = useCallback(async (text: string, requestMode: "create" | "plan", options?: Parameters<typeof submitSources>[2]) => {
    const outcome = await submitLatest.current(text, requestMode, options);
    if (outcome === undefined || outcome === "refused") restoreBrief(text);
    return outcome;
  }, [restoreBrief]);
  /** Structured design answers chosen before a Plan, kept for the approved plan's build. */
  const planDesign = useRef<DesignAnswers | null>(null);
  const proceed = useCallback((text: string, requestMode: "create" | "plan", design: DesignAnswers, original: string) => {
    // Affordability first: a brief that cannot be built is never read or enhanced, and stays in the composer.
    const quoteIssue = affordability(BUILDER_EFFORT[effort].ceilingCredits, balance);
    if (quoteIssue) { restoreBrief(text, quoteIssue); return; }
    if (!website) { void startDeferred(text, requestMode); return; }
    if (requestMode !== "create") { planDesign.current = Object.keys(design).length ? design : null; void startDeferred(text, requestMode); return; }
    if (!shouldEnhance(original)) {
      // A detailed brief is never rewritten: a free analysis lists what the client's own words ask for, then the build starts.
      enhanceAbort.current?.abort();
      const controller = new AbortController(); enhanceAbort.current = controller;
      const timer = window.setTimeout(() => controller.abort(), 45_000);
      setAnalyzing({ text, design });
      void enhanceBrief(text, design, controller.signal, original).then(result => {
        window.clearTimeout(timer);
        if (enhanceAbort.current !== controller) return;
        enhanceAbort.current = null; setAnalyzing(null);
        // A refusal that would stop the build too (AI paused, daily limit, no credits) is shown, and nothing starts.
        if (result.status === "failed" && result.blocking) { restoreBrief(text, result.message ?? "Building isn't available right now. Nothing was started or charged."); return; }
        const ready = result.status === "ready" ? result : null;
        void startDeferred(text, "create", { ...(Object.keys(design).length ? { design } : {}), ...(ready ? { brief: { mode: "analysis", text: ready.text } } : {}), enhanced: { mode: ready ? "analysis" : "original", credits: 0 } });
      });
      return;
    }
    enhanceAbort.current?.abort();
    const controller = new AbortController(); enhanceAbort.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 45_000);
    setEnhancing({ text, design, state: { status: "loading" } });
    void enhanceBrief(text, design, controller.signal, original).then(result => {
      window.clearTimeout(timer);
      if (enhanceAbort.current !== controller) return;
      setEnhancing(current => current && current.text === text ? { ...current, state: result } : current);
    });
  }, [balance, effort, enhanceBrief, restoreBrief, startDeferred, website]);
  const proceedLatest = useRef(proceed);
  useEffect(() => { proceedLatest.current = proceed; }, [proceed]);
  const startEnhanced = (brief: BuildBrief | null) => {
    if (!enhancing) return;
    const previous = enhancing, { text, design, state } = enhancing;
    enhanceAbort.current?.abort(); enhanceAbort.current = null;
    setEnhancing(null);
    const credits = state.status === "ready" ? state.charged : 0;
    void submitLatest.current(text, "create", { design, ...(brief ? { brief } : {}), enhanced: { mode: brief?.mode ?? "original", credits } }).then(outcome => {
      if (outcome !== undefined && outcome !== "refused") return;
      // Refused before it started: the card comes back with the client's edits, and the brief is in the composer too.
      setEnhancing(brief && previous.state.status === "ready" ? { ...previous, state: { ...previous.state, text: brief.text } } : previous);
      restoreBrief(text);
    });
  };
  const cancelEnhanced = () => {
    if (!enhancing) return;
    enhanceAbort.current?.abort(); enhanceAbort.current = null;
    setDraft(enhancing.text); setEnhancing(null); asked.current = false;
    setNotice("Your brief is back in the composer. Nothing was started.");
  };
  // The first request on an empty project asks what the brief leaves open.
  const firstBuild = !turns.length && !history.length && !planner.restored && version <= 1 && (website ? Object.keys(baseFiles).length === 0 : !baseDocument);
  /** `prepared` is a brief handed over from another screen (project creation): it may ask the free
   * questions, but paid work starts only from an explicit Send or Start after the maximum is shown. */
  const startOrAsk = useCallback((text: string, requestMode: "create" | "plan", target?: string, prepared = false) => {
    const hold = () => { setDraft(text.trim()); if (website) setMode(requestMode); setNotice(`Your brief is ready below. Review it and the maximum, then choose ${requestMode === "plan" ? "Plan" : "Send"} to start. Nothing has been sent.`); };
    const issue = sourceIntentIssue(readiness);
    if (issue) { setNotice(issue); setDraft(text); return; }
    if (asking) { setNotice("Answer the questions above, or choose Skip questions."); return; }
    if (enhancing) { setNotice("Choose how to start with the brief above, or Cancel."); return; }
    if (analyzing) { setNotice("Your brief is being read; the build starts in a moment."); return; }
    if (firstBuild && !asked.current && text.trim()) {
      asked.current = true;
      const brief = text.trim(), attachments = sources.files.length;
      // A detailed brief has nothing left to ask: it goes straight on (a website brief to its free reading, then the build).
      if (!questionLimit(kind, brief)) { if (prepared) { asked.current = false; hold(); } else { setDraft(""); proceedLatest.current(brief, requestMode, {}, brief); } return; }
      setAsking({ text: brief, mode: requestMode, questions: null }); setDraft("");
      // The on-device design questions for this brief, with AI-tailored business questions merged in when available.
      void tailoredQuestions(brief, attachments).then(tailored => {
        const questions = mergedQuestions(kind, brief, tailored, { attachments });
        if (!questions.length) { setAsking(null); if (prepared) hold(); else proceedLatest.current(brief, requestMode, {}, brief); return; }
        setAsking(current => current && current.text === brief && !current.questions ? { ...current, questions } : current);
      });
      return;
    }
    if (prepared) { hold(); return; }
    void submitSources(text, requestMode, target ? { target } : undefined);
  }, [analyzing, asking, enhancing, firstBuild, kind, readiness, sources.files.length, submitSources, tailoredQuestions, website]);
  const answerQuestions = (answers: BriefAnswers | null) => {
    if (!asking) return;
    const { text, mode: requestMode, questions } = asking;
    setAsking(null);
    // Only chosen answers reach the brief and the design seed (a skipped one never does, F04).
    proceed(answers && questions ? briefWithAnswers(text, questions, answers) : text, requestMode, answers && questions && website ? designAnswers(questions, answers) : {}, text);
  };
  const submit = (text: string) => {
    // A selected element must still be exactly what the user saw; otherwise refuse instead of editing another one.
    const issue = targetIssue(target, text, baseFiles, version);
    if (issue) { setNotice(issue); return; }
    const bound = target && text.includes(targetReference(target)) ? target : null;
    if (!bound) setTarget(null);
    startOrAsk(text, mode, bound ? `${bound.label} · ${targetReference(bound)}` : undefined);
  };
  /** Builds exactly the saved plan revision shown, at the effort shown. Unsaved edits save first;
   * a repeated click for the same approval reuses its request identity, so the server joins it. */
  const buildPlan = async (approved: SitePlan, level: EffortLevel, maximum: number) => {
    if (approvingRef.current || busy || disabled || operationRunning || previewingRecovery || sourceLock.current) return;
    // The plan card passes the maximum it showed; the server ceiling for the effort is the same number and the fallback.
    if (!Number.isFinite(maximum)) maximum = BUILDER_EFFORT[level].ceilingCredits;
    const quoteIssue = affordability(maximum, balance);
    if (quoteIssue) { setNotice(quoteIssue); return; }
    approvingRef.current = true; setApproving(true); setNotice("");
    try {
      const saved = await planner.approve(approved);
      if (!sourceSession.active) return;
      const identity = planApprovalIdentity({ revision: saved.revision, effort: level, version });
      const approval = approvals.current.get(identity) ?? { actionKey: newId(), stepKey: newId() };
      approvals.current.set(identity, approval);
      setMode("create"); setEffort(level);
      const outcome = await submitSources(`Build the approved plan: ${saved.plan.title}`, "create", { plan: saved.plan, planRevision: saved.revision, effort: level, approval, approvedMaximum: maximum,
        // The structured design answers chosen before the plan still bind its build (must-have sections, imagery, theme).
        ...(planDesign.current ? { design: planDesign.current } : {}),
        target: `saved plan v${saved.revision} · ${EFFORT_PRESENTATION[level].label} effort` });
      // Only an unknown outcome keeps the identity: building it again then joins the recorded request.
      if (outcome !== "uncertain") approvals.current.delete(identity);
    } catch (error) {
      if (sourceSession.active) setNotice(error instanceof Error ? error.message : "The plan could not be approved.");
    } finally { approvingRef.current = false; if (sourceSession.active) setApproving(false); }
  };
  const shownSources = sentSources?.names ?? (retainedSources && retainedSources.operationId === operation?.id ? retainedSources.names : null);
  const undoReason = undoIssue(lastChange, { version, available: Boolean(onUndo),
    blocked: busy || approving || operationRunning ? "Wait for the current request to finish." : previewingRecovery ? "Return to the saved version first." : undoBlocked });
  const undo = () => {
    if (!lastChange || undoReason || !onUndo) return;
    const error = onUndo(lastChange);
    if (error) { setNotice(error); return; }
    setUndoing(lastChange); setLastChange(null);
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
        const meter = newRunMeter();
        try { await reviewRound({ version, round: 1, effort: approved.effort, operation: approved }, { files: { ...baseFiles }, assets: [...baseAssets] }, meter); }
        finally { if (sourceSession.active) addReceipt(meter); await finishRun(); }
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
    revision={active.stored.revision} built={active.stored.status === "built"} save={active.save} brandKit={brandKit} busy={busy || approving || preparingSources || !sources.ready || sources.busy || disabled || operationRunning || Boolean(previewingRecovery)}
    onChange={planner.edit} onBuild={(approved, level, maximum) => void buildPlan(approved, level, maximum)} onRevise={revisePlan} />;

  useEffect(() => {
    if (!autoStart || started.current || disabled || !sources.ready || sources.busy || readiness.checking || turns.length || version > 1 || !operationReady || !planner.ready || hasPreviousOperation || planner.hasPrevious) return;
    started.current = true;
    startOrAsk(autoStart, autoStartMode === "plan" && website ? "plan" : "create", undefined, true);
  }, [autoStart, autoStartMode, disabled, hasPreviousOperation, operationReady, planner.hasPrevious, planner.ready, readiness.checking, sources.busy, sources.ready, startOrAsk, turns.length, version, website]);


  const empty = !turns.length && !history.length && !planner.restored;
  // Phones show the preview first; the conversation opens on demand above the composer.
  const lastAssistant = [...turns].reverse().find(turn => turn.role === "assistant");
  const chatSummary = busy ? [...(lastAssistant?.activity ?? [])].reverse().find(item => !item.done)?.label ?? "Working…"
    : lastAssistant?.receipt ? (lastAssistant.receipt.charged === null ? "Finished · check the charge" : `Finished · ${lastAssistant.receipt.charged} credit${lastAssistant.receipt.charged === 1 ? "" : "s"}`)
    : turns.length ? `Conversation · ${turns.filter(turn => turn.role === "user").length} request${turns.filter(turn => turn.role === "user").length === 1 ? "" : "s"}`
    : history.length ? `${history.length} earlier change${history.length === 1 ? "" : "s"}` : "Conversation";
  const measured = estimates && effort === estimates.effort && firstBuild ? estimates.firstBuild[kind] : null;
  const ceiling = BUILDER_EFFORT[effort].ceilingCredits;
  // Prompt help (enhancement or analysis) is free, so the maximum is the build's own ceiling.
  const shownMaximum = ceiling;
  const canReview = website && Object.keys(baseFiles).length > 0;
  const quoteIssue = affordability(mode === "plan" ? PLAN_CEILING_CREDITS : ceiling, balance);
  return <aside className="lb" aria-label="Builder chat" data-chat-open={chatOpen || undefined} onKeyDown={event => closeSheetOnEscape(event, chatOpen, () => setChatOpen(false), ".lb-log")}>
    <button type="button" className="workbench-chat-toggle" aria-expanded={chatOpen} aria-controls={`lb-log-${artifactId}`} onClick={() => setChatOpen(open => !open)}>
      {busy ? <Loader2 size={14} className="lb-spin" /> : <MessageSquare size={14} />}<span aria-live="polite">{chatSummary}</span><ChevronDown size={15} className="workbench-chat-chevron" />
    </button>
    <div className="lb-log" id={`lb-log-${artifactId}`} ref={log} aria-live="polite">
      {empty && !asking && <div className="lb-intro"><Sparkles size={18} /><h3>{copy.title}</h3><p>{copy.intro}</p></div>}
      {asking && <><div className="lb-turn lb-user"><p>{asking.text}</p></div>
        <div className="lb-turn lb-assistant">{!asking.questions ? <div className="bq bq-loading" role="status"><Loader2 size={14} className="lb-spin" /><span>Reading your brief to see what to ask… (questions are free)</span><button type="button" className="bq-skip" onClick={() => answerQuestions(null)}>{website && asking.mode === "create" && shouldEnhance(asking.text) ? "Skip questions" : <>Skip questions and start · up to {asking.mode === "plan" ? PLAN_CEILING_CREDITS : ceiling} credits</>}</button></div>
          : <BriefQuestionsCard questions={asking.questions} kind={kind} planning={asking.mode === "plan"} busy={busy || preparingSources || Boolean(disabled)}
          finalLabel={website && asking.mode === "create" && shouldEnhance(asking.text) ? "Continue" : undefined}
          limit={`Starting ${asking.mode === "plan" ? "the plan" : "the build"} uses up to ${asking.mode === "plan" ? PLAN_CEILING_CREDITS : ceiling} credits, with ${sources.files.length ? `your source files: ${sources.files.filter(file => !leftOut.has(file.id)).map(file => file.name).join(", ") || "none"}` : "no source files"}. You pay only for what is used.`}
          onStart={answers => answerQuestions(answers)} onSkip={() => answerQuestions(null)} />}</div></>}
      {analyzing && <><div className="lb-turn lb-user"><p>{analyzing.text}</p></div>
        <div className="lb-turn lb-assistant"><div className="bq bq-loading" role="status"><Loader2 size={14} className="lb-spin" /><span>Reading your brief to list everything it asks for… (free)</span>
          <button type="button" className="bq-skip" onClick={() => { const current = analyzing; enhanceAbort.current?.abort(); enhanceAbort.current = null; setAnalyzing(null); void startDeferred(current.text, "create", { ...(Object.keys(current.design).length ? { design: current.design } : {}), enhanced: { mode: "original", credits: 0 } }); }}>Skip and start</button></div></div></>}
      {enhancing && <><div className="lb-turn lb-user"><p>{enhancing.text}</p></div>
        <div className="lb-turn lb-assistant"><EnhancedBriefCard key={enhancing.state.status} state={enhancing.state} design={enhancing.design} maximum={ceiling} busy={busy || preparingSources || Boolean(disabled)}
          onStart={brief => startEnhanced(brief)} onOriginal={() => startEnhanced(null)} onCancel={cancelEnhanced} /></div></>}
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
        {turn.enhancedBrief && <details className="lb-enhanced"><summary>{turn.enhancedBrief.mode === "edited" ? "Enhanced brief (your edits)" : turn.enhancedBrief.mode === "analysis" ? "Brief analysis" : "Enhanced brief"}</summary><pre>{turn.enhancedBrief.text}</pre></details>}
        {turn.plan && planner.active?.turnId === turn.id && planCard(planner.active)}
        {typeof turn.plan === "object" && planner.active?.turnId !== turn.id && <div className="pc pc-collapsed"><ListChecks size={14} /><span>Plan v{turn.plan.revision} · <strong>{turn.plan.title}</strong> — revised below</span></div>}
        {!!turn.activity.length && <ul className="lb-activity">{turn.activity.map(item => <li key={item.id} data-done={item.done}>
          {item.done ? <Check size={13} /> : <Loader2 size={13} className="lb-spin" />}
          {item.kind === "image" ? <ImageIcon size={13} /> : item.kind === "file" ? <FileCode2 size={13} /> : null}
          <span>{item.label}</span></li>)}</ul>}
        {turn.role === "assistant" && !turn.review && turn.state === "streaming" && !turn.text && !turn.activity.length && <p className="lb-thinking"><Loader2 size={14} className="lb-spin" /> Thinking…</p>}
        {turn.receipt && <Receipt receipt={turn.receipt} kind={kind} />}
        {turn.role === "assistant" && typeof turn.credits === "number" && turn.credits > 0 && <small className="lb-cost">{turn.state === "streaming" ? `${turn.credits} credits so far` : `${turn.credits} credits`}</small>}
      </div>)}
    </div>
    {(lastChange || undoing) && <section className="lb-undo" aria-label="Last AI change">
      {lastChange ? <><p>Saved as version {lastChange.to}, from version {lastChange.from}.</p>
        <button type="button" className="button small" disabled={Boolean(undoReason)} aria-describedby={undoReason ? `lb-undo-reason-${artifactId}` : undefined} onClick={undo}>Undo this change</button>
        {undoReason && <small id={`lb-undo-reason-${artifactId}`}>{undoReason}</small>}</>
        : undoing && <p role="status">{version > undoing.to ? `Restored version ${undoing.from} as version ${version}. Version ${undoing.to} stays in History.` : `Restoring version ${undoing.from} as a new version…`}</p>}
      <small>Undo saves the earlier version as a new version. History is kept and nothing is published.</small>
    </section>}
    {(operation || recoveryNotice || previewingRecovery) && <section className="lb-operation" aria-label="Request allowance">
      {operation && <><div className="lb-operation-total"><strong>{operation.chargedCredits} / {operation.authorizedCredits} credits</strong><span>{operation.reservedCredits > 0 ? `${operation.reservedCredits} reserved` : "Total request maximum"}</span></div>
        <p>This allowance covers the request and its automatic refinements.</p>
        {(() => { const phase = operationPhase(operation, { recovery: mode === "create" ? Boolean(buildRecovery) : Boolean(planner.recoverablePlan), pendingCancel }); return phase && <p className="lb-operation-phase" data-phase={phase.label}><strong>{phase.label}.</strong> {phase.detail}</p>; })()}
        {shownSources && <p className="lb-operation-sources">{shownSources.length ? `Sources sent with this request: ${shownSources.join(", ")}` : "No source files were sent with this request."}</p>}</>}
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
        <p>A retained draft is available. {recoverEffect(version)}</p>
        {!previewingRecovery ? <button type="button" className="button small" disabled={busy || disabled} onClick={previewRecovery}>Preview retained draft</button>
          : <button type="button" className="button small" disabled={busy || disabled || previewingRecovery.version !== version} onClick={() => void saveRecovery()}>Save reviewed draft</button>}
      </div>}
      {previewingRecovery && <button type="button" className="lb-operation-check" disabled={busy} onClick={() => { onLive(null); setPreviewingRecovery(null); setNotice(""); }}>Return to saved version</button>}
      {operation?.kind === "build" && operation.canContinue && operation.status !== "running" && operation.maximumAdditionalCredits > 0 && <div className="lb-operation-consent">
        <p id={`lb-continue-effect-${artifactId}`}>{continueEffect(operation, version)}</p>
        <button type="button" className="button small" disabled={busy || disabled || checkingOperation || Boolean(previewingRecovery)} aria-describedby={`lb-continue-effect-${artifactId}`} onClick={() => void continueOperation()}>Approve allowance & continue</button>
      </div>}
      <p className="lb-operation-note" id={`lb-check-effect-${artifactId}`}>{CHECK_EFFECT}</p>
      <button type="button" className="lb-operation-check" aria-describedby={`lb-check-effect-${artifactId}`} disabled={busy || checkingOperation} onClick={() => void checkCurrentOperation().then(() => onSaved()).catch(() => setNotice("The saved result could not be refreshed. Try checking again."))}>{checkingOperation ? "Checking…" : "Check saved result & charge"}</button>
    </section>}
    <form className="lb-composer" data-mode={mode} onSubmit={event => { event.preventDefault(); submit(draft); }}>
      {mode === "plan" && <p className="lb-plan-note"><ListChecks size={12} />{draftPlan ? "Plan mode — your reply revises the plan above." : "Plan mode — I'll study your project and propose a plan. No code is written."}</p>}
      {draftPlan && <p className="lb-plan-note">Building the approved plan uses the source files currently listed here. Review this selection if you changed files after planning.</p>}
      {inFlight && <p className="lb-pending" role="status"><Loader2 size={12} className="lb-spin" /><span className="lb-pending-text">Sending “{short(inFlight.text)}” · based on version {inFlight.baseVersion}{inFlight.target ? ` · ${inFlight.target}` : ""}</span></p>}
      {!inFlight && earlier && <div className="lb-pending" role="status">
        <p>A request from {new Date(earlier.sentAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}, based on version {earlier.baseVersion}, may already have been sent: “{short(earlier.text)}”. Check the saved result before sending it again.</p>
        <span><button type="button" disabled={busy || Boolean(draft.trim())} onClick={() => { setDraft(earlier.text); setEarlier(null); if (pendingScope) clearPendingRequest(browserStorage(), pendingScope); }}>Put it back in the composer</button>
        <button type="button" onClick={() => { setEarlier(null); if (pendingScope) clearPendingRequest(browserStorage(), pendingScope); }}>Dismiss</button></span>
      </div>}
      {target && draft.includes(targetReference(target)) && <p className="lb-target"><span>Editing {target.label} · {targetReference(target)} · selected in version {target.version}</span>
        <button type="button" onClick={() => setTarget(null)}>Clear target</button></p>}
      {provenance && <p className="lb-provenance" data-status={provenance.status}><span>{provenance.status === "pending" ? `From ${provenanceLabel(provenance.provenance)} · recorded with your next request. The advice itself changed nothing here.` : `Started from ${provenanceLabel(provenance.provenance)}`}</span>
        {provenance.status === "pending" && onProvenance && <button type="button" disabled={busy} onClick={() => onProvenance(null)}>Don’t record</button>}</p>}
      <UnsentDraftNotice restoredAt={unsent.restoredAt} storageRefused={unsent.storageRefused} onDiscard={unsent.discard} disabled={busy} className="lb-unsent" />
      <AttachmentList files={sources.files} readiness={readiness} onRetry={readiness.retry}
        onExclude={id => setLeftOut(current => new Set(current).add(id))} onInclude={id => setLeftOut(current => { const next = new Set(current); next.delete(id); return next; })}
        onRemove={id => void sources.remove(id)} removeLabel={name => `Delete ${name} from this project on this device`}
        disabled={busy || preparingSources || sources.busy || disabled || operationRunning} compact
        note="Saved on this device for this project. Leave out skips a file for this request only; × deletes the saved copy. Continuing uses the original request’s files." />
      <p className="lb-plan-note lb-source-formats">AI sources: PNG, JPEG, WebP, GIF, PDF, TXT or Markdown · up to 5 files, 3 MB combined. Text: up to 200,000 characters.</p>
      {sources.error && <p className="lb-notice" role="alert">{sources.error}</p>}
      <textarea ref={composer} aria-label="Message the builder" placeholder={mode === "plan" ? draftPlan ? "Revise the plan — e.g. add a pricing page, warmer palette" : "What should we plan? Describe the site or the change" : empty ? copy.start : copy.edit} value={draft} rows={3} maxLength={8000} disabled={busy || preparingSources || !sources.ready || sources.busy || disabled || operationRunning || Boolean(previewingRecovery)}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(draft); } }} />
      <div className="lb-controls">
        {website && <div className="lb-mode" role="group" aria-label="Mode">
          <button type="button" aria-pressed={mode === "create"} disabled={busy || operationRunning || Boolean(previewingRecovery)} onClick={() => setMode("create")} title="Build: edit the website directly"><Hammer size={12} />Build</button>
          <button type="button" aria-pressed={mode === "plan"} disabled={busy || operationRunning || Boolean(previewingRecovery)} onClick={() => setMode("plan")} title="Plan: propose an editable plan first, no code"><ListChecks size={12} />Plan</button>
        </div>}
        <label className="lb-attach" aria-label="Attach files"><Paperclip size={15} /><input type="file" multiple accept={BUILDER_ATTACHMENT_ACCEPT} disabled={busy || preparingSources || !sources.ready || sources.busy || disabled || operationRunning || Boolean(previewingRecovery)} onChange={event => { void sources.add(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label>
        <select aria-label="Effort" value={effort} disabled={busy || operationRunning || Boolean(previewingRecovery)} onChange={event => setEffort(event.target.value as EffortLevel)} title={EFFORT_PRESENTATION[effort].purpose}>
          {EFFORT_LEVELS.map(level => <option key={level} value={level}>{EFFORT_PRESENTATION[level].label}</option>)}
        </select>
        {canReview && <button type="button" className="lb-review" aria-label={`Review design, up to ${reviewCreditCeiling(BUILDER_EFFORT[effort].ceilingCredits)} credits`} disabled={busy || preparingSources || !sources.ready || sources.busy || disabled || operationRunning || Boolean(previewingRecovery)} onClick={() => void review()} title="Look at the site on desktop and mobile and fix visual problems"><Eye size={14} /><span className="lb-review-label">Review · {reviewCreditCeiling(BUILDER_EFFORT[effort].ceilingCredits)} max</span></button>}
        {quoteIssue && <p className="lb-credit-warning" role="status">{quoteIssue} <a href="/billing#credits">Review credits</a></p>}
        <span className="lb-balance">{balance ? balance.unlimited ? "Unlimited credits" : `${balance.available} credits` : ""}</span>
        {(busy || operationRunning) ? <button type="button" className="lb-stop" disabled={cancelling || operation?.cancelRequested === true} aria-describedby={`lb-stop-effect-${artifactId}`}
          onClick={() => void stop().catch(() => setNotice("Stop could not be confirmed. Check the recorded request before retrying."))}
          aria-label={operation?.cancelRequested ? "Stopping" : pendingCancel ? "Retry Stop" : "Stop"}>
          {cancelling || operation?.cancelRequested ? <Loader2 size={14} className="lb-spin" /> : <Square size={12} />}<span>{operation?.cancelRequested ? "Stopping..." : pendingCancel ? "Retry Stop" : "Stop"}</span>
        </button> : <button type="submit" className="lb-send" aria-label={mode === "plan" ? "Plan" : "Send"} disabled={busy || preparingSources || !sources.ready || sources.busy || readiness.checking || disabled || operationRunning || Boolean(previewingRecovery) || !draft.trim()}>{busy ? <Loader2 size={16} className="lb-spin" /> : <ArrowUp size={16} />}</button>}
      </div>
      {(busy || operationRunning) && <p className="lb-action-effect" id={`lb-stop-effect-${artifactId}`}>{stopEffect(operation, version, pendingCancel && !operation?.cancelRequested)}</p>}
      <div className="lb-estimate">
        {brandKit !== undefined && <p className="lb-brand">{brandKit ? `Brand kit: ${brandKit}` : "No brand kit"} · used for this request</p>}
        <p className="lb-limit">Up to {mode === "plan" ? PLAN_CEILING_CREDITS : shownMaximum} credits for this {mode === "plan" ? "plan" : "request, including automatic refinements"}.</p>
        {/* Only measured figures: failed planning is released at zero; explicit Stop settles confirmed usage. */}
        <p className="lb-estimate-detail">{mode === "plan" ? "A failed plan is not charged. If you choose Stop, confirmed usage is charged and unused credits are returned."
          : measured ? `In testing, a first ${kind} at ${EFFORT_PRESENTATION[effort].label} used ${measured.min}–${measured.max} credits (${measured.samples} test ${kind}s, no AI images). You pay only for what is used.`
          : `You pay only for what is used, never more than ${ceiling} credits without your approval.`}</p>
        {/* Phones: one line instead of the three above (limit, measured range, balance). */}
        <p className="lb-estimate-compact">Up to {mode === "plan" ? PLAN_CEILING_CREDITS : shownMaximum} credits{mode !== "plan" && measured ? ` · first builds used ${measured.min}–${measured.max} in testing` : ""} · pay for what’s used{balance ? ` · ${balance.unlimited ? "unlimited" : `${balance.available} left`}` : ""}</p>
      </div>
      {(notice || (disabled && disabledReason)) && <p className="lb-notice" role="status">{notice || disabledReason}</p>}
    </form>
  </aside>;
}
