import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArtifactVersion } from "../domain";
import { mapArtifact, mapVersion } from "../cloud/mappers";
import { RequestError } from "../server/http";
import { builtTitle } from "../projects/project-title";
import { chartSvg } from "../documents/chart-svg";
import { FONTS, mix } from "../documents/theme";
import { projectDocument, documentAssetIds } from "../documents/project";
import type { Chart, DocumentSource, Theme } from "../documents/schema";
import { storeProjectImage } from "../builder/images";
import { buildDocument, type ChartImages } from "./documents";
import type { FactsSheet } from "./facts";
import type { RenderedNarrative } from "./narrative";
import { REPORT_FILE_TYPES, documentSha, reportAssetId, reportObjectPath, type ReportFormat } from "./files";

/**
 * Persistence for a generated data report, all through the caller's RLS-bound
 * client and the existing save path. Order: chart figures (books) → document
 * → PDF (+ editable PPTX for decks) rendered here → facts sheet, chart data and
 * final files stored as immutable project assets → ONE new artifact version
 * saved with the expected-version check, whose asset manifest references every
 * one of them (so retention keeps them). Nothing lives only in a temporary
 * location: if the save is refused, the stored files stay unreferenced and
 * immutable, and nothing in the project changes.
 */
type Scope = { workspaceId: string; projectId: string };
export type StoredReportFile = { format: ReportFormat; assetId: string; sha256: string; bytes: number };

/** Upload (never overwriting) and register one immutable report file; idempotent for the same bytes. */
export async function storeReportFile(client: SupabaseClient, scope: Scope, format: ReportFormat, bytes: Buffer, provenance: Record<string, unknown>): Promise<StoredReportFile> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const id = reportAssetId(scope, sha256), objectPath = reportObjectPath(scope, sha256, format);
  const existing = await client.from("assets").select("id,sha256,project_id").eq("workspace_id", scope.workspaceId).eq("id", id).maybeSingle();
  if (existing.error) throw new RequestError("REPORT_STORAGE_UNAVAILABLE", "The report files couldn’t be stored. Nothing was changed; try again.", 503);
  if (!existing.data) {
    const uploaded = await client.storage.from("project-assets").upload(objectPath, bytes, { contentType: REPORT_FILE_TYPES[format], upsert: false, cacheControl: "0" });
    if (uploaded.error && !/exists|duplicate/i.test(uploaded.error.message))
      throw new RequestError("REPORT_STORAGE_UNAVAILABLE", "The report files couldn’t be stored. Nothing was changed; try again.", 503);
    const inserted = await client.from("assets").insert({ id, workspace_id: scope.workspaceId, project_id: scope.projectId, object_path: objectPath, content_type: REPORT_FILE_TYPES[format], sha256,
      provenance: { ...provenance, byteLength: bytes.length } });
    if (inserted.error && inserted.error.code !== "23505") throw new RequestError("REPORT_STORAGE_UNAVAILABLE", "The report files couldn’t be registered. Nothing was changed; try again.", 503);
  } else if (existing.data.sha256 !== sha256 || existing.data.project_id !== scope.projectId) throw new RequestError("REPORT_STORAGE_CONFLICT", "A stored report file could not be matched safely.", 409);
  return { format, assetId: id, sha256, bytes: bytes.length };
}

/** A chart figure for print: the preview's own SVG chart, on the document's background, as PNG. */
export async function chartPng(chart: Chart, theme: Theme): Promise<Buffer> {
  const p = theme.palette, fonts = FONTS[theme.fonts];
  const colors = { ink: p.ink, muted: p.muted, grid: mix(p.muted, p.background, 0.7), series: [p.accent, p.accent2, mix(p.ink, p.background, 0.45)], highlight: p.accent, dim: mix(p.accent, p.background, 0.55), background: p.background };
  // Drawn at about the printed size, so its labels stay legible on a book page.
  const inner = chartSvg(chart, 760, 400, colors, { heading: fonts.heading, body: fonts.body }).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1680" height="960" viewBox="0 0 840 480"><rect width="840" height="480" fill="${p.background}"/><svg x="40" y="40" width="760" height="400" viewBox="0 0 760 400">${inner}</svg></svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

export type PersistDeps = {
  renderPdf: (doc: DocumentSource, images: Record<string, Buffer>) => Promise<Buffer>;
  renderPptx: (doc: DocumentSource, images: Record<string, Buffer>) => Promise<Buffer>;
  /** Existing document images (append mode), read through the caller's client and re-hashed. */
  loadImages: (doc: DocumentSource) => Promise<Record<string, Buffer>>;
  storeImage?: typeof storeProjectImage;
};
export type PersistInput = {
  client: SupabaseClient; scope: Scope;
  artifact: { id: string; kind: "book" | "presentation"; current_version: number };
  current: ArtifactVersion; expectedVersion: number; actionKey: string;
  facts: FactsSheet; narrative: RenderedNarrative; narrativeSource: "plain" | "ai";
  mode: "replace" | "append"; title?: string; sourceName: string; sourceAsset: { id: string; sha256: string };
};
export type PersistResult = { replayed: boolean; version: { id: string; number: number }; files: StoredReportFile[]; documentSha: string; artifact?: ReturnType<typeof mapArtifact> };

const stale = () => new RequestError("REPORT_STALE", "The project changed since these numbers were checked. Reload it and generate again. Nothing was saved.", 409);

/** A version this action already saved (retry after an uncertain response): found through its facts file's provenance. */
export async function committedReport(client: SupabaseClient, scope: Scope, artifactId: string, afterVersion: number, actionKey: string): Promise<PersistResult | null> {
  const versions = await client.from("artifact_versions").select("id,version_number,asset_manifest").eq("workspace_id", scope.workspaceId).eq("artifact_id", artifactId)
    .gt("version_number", afterVersion).order("version_number", { ascending: true }).limit(10);
  if (versions.error) throw new RequestError("CLOUD_UNAVAILABLE", "The project could not be read. Try again.", 503);
  for (const version of versions.data ?? []) {
    const ids = Array.isArray(version.asset_manifest) ? version.asset_manifest as string[] : [];
    if (!ids.length) continue;
    const assets = await client.from("assets").select("id,sha256,content_type,provenance").eq("workspace_id", scope.workspaceId).eq("project_id", scope.projectId).in("id", ids);
    if (assets.error) throw new RequestError("CLOUD_UNAVAILABLE", "The project could not be read. Try again.", 503);
    const mine = (assets.data ?? []).filter(row => { const p = row.provenance as Record<string, unknown> | null; return p?.actionKey === actionKey && (p.kind === "data_report_facts" || p.kind === "data_report_file"); });
    const factsRow = mine.find(row => (row.provenance as Record<string, unknown>).kind === "data_report_facts");
    if (!factsRow) continue;
    const files = mine.map(row => { const p = row.provenance as Record<string, unknown>; return { format: (p.kind === "data_report_facts" ? "facts" : p.format) as ReportFormat, assetId: row.id as string, sha256: row.sha256 as string, bytes: Number(p.byteLength) || 0 }; });
    return { replayed: true, version: { id: version.id as string, number: version.version_number as number }, files, documentSha: String((factsRow.provenance as Record<string, unknown>).documentSha ?? "") };
  }
  return null;
}

export async function persistDataReport(input: PersistInput, deps: PersistDeps): Promise<PersistResult> {
  const { client, scope, artifact, facts } = input;
  const replay = await committedReport(client, scope, artifact.id, input.expectedVersion, input.actionKey);
  if (replay) return replay;
  if (artifact.current_version !== input.expectedVersion || input.current.number !== input.expectedVersion) throw stale();
  const base = input.current.content.document ?? null;
  const docKind = artifact.kind === "book" ? "book" : "deck";
  if (base && base.kind !== docKind) throw new RequestError("WRONG_DOCUMENT", "This project’s document type doesn’t match the report.", 409);
  const theme = base?.theme;
  // Book reports show charts as figures rendered from the same chart data (the PDF has no native charts).
  const chartImages: Record<string, { name: string; assetId: string }> = {}, images: Record<string, Buffer> = {};
  if (docKind === "book") {
    const store = deps.storeImage ?? storeProjectImage;
    const draft = buildDocument({ facts, narrative: input.narrative, base, mode: input.mode, title: input.title, sourceName: input.sourceName });
    for (const chart of facts.charts) {
      const png = await chartPng(chart.chart, theme ?? draft.theme);
      const stored = await store(client, scope, png, { kind: "data_report_chart", chartId: chart.id, factsDigest: facts.digest, actionKey: input.actionKey }, { lossless: true });
      const name = `chart-${chart.id.replace(/[^a-z0-9-]/g, "-")}`.slice(0, 48);
      chartImages[chart.id] = { name, assetId: stored.id };
      images[name] = stored.data;
    }
  }
  const doc = buildDocument({ facts, narrative: input.narrative, base, mode: input.mode, title: input.title, sourceName: input.sourceName, chartImages: chartImages as ChartImages });
  if (input.mode === "append" && base) Object.assign(images, await deps.loadImages(base));
  const sha = documentSha(doc);
  let pdf: Buffer, pptx: Buffer | null = null;
  try {
    pdf = await deps.renderPdf(doc, images);
    if (doc.kind === "deck") pptx = await deps.renderPptx(doc, images);
  } catch {
    throw new RequestError("REPORT_EXPORT_FAILED", "The report files couldn’t be produced. Nothing was saved; please try again.", 500);
  }
  const common = { actionKey: input.actionKey, template: facts.template, factsDigest: facts.digest, documentSha: sha, source: { assetId: input.sourceAsset.id, sha256: input.sourceAsset.sha256 } };
  const factsFile = await storeReportFile(client, scope, "facts", Buffer.from(JSON.stringify({ ...facts, report: { documentSha: sha, narrative: { source: input.narrativeSource, text: input.narrative } } }, null, 1)),
    { kind: "data_report_facts", ...common });
  const files = [factsFile, await storeReportFile(client, scope, "pdf", pdf, { kind: "data_report_file", format: "pdf", ...common, factsAssetId: factsFile.assetId })];
  if (pptx) files.push(await storeReportFile(client, scope, "pptx", pptx, { kind: "data_report_file", format: "pptx", ...common, factsAssetId: factsFile.assetId }));
  const content = { schemaVersion: 1, kind: artifact.kind, title: builtTitle(input.current.content.title, doc.title, "", artifact.kind).slice(0, 200), sections: projectDocument(doc), document: doc };
  const assetIds = [...new Set([...input.current.assetIds, ...documentAssetIds(doc), ...files.map(file => file.assetId)].map(id => id.toLowerCase()))];
  const { data, error } = await client.rpc("makeborne_save_artifact_version", {
    p_workspace_id: scope.workspaceId, p_artifact_id: artifact.id, p_expected_version: input.expectedVersion,
    p_content: content, p_style: input.current.style, p_asset_ids: assetIds,
    p_change_summary: `Data report (${facts.template.replace(/_/g, " ")}) from ${input.sourceName}`.slice(0, 2000), p_request_key: input.actionKey,
  });
  if (error) {
    if (error.code === "PT409" || error.code === "40001") throw stale();
    if (error.code === "42501") throw new RequestError("ACCESS_DENIED", "You do not have permission to change this work.", 403);
    if (error.code === "MB409") { const again = await committedReport(client, scope, artifact.id, input.expectedVersion, input.actionKey); if (again) return again; }
    throw new RequestError("CLOUD_OUTCOME_UNKNOWN", "Saving could not be confirmed. Retry the same request before doing anything else.", 503);
  }
  if (!data || typeof data !== "object" || !data.version) throw new RequestError("CLOUD_UNAVAILABLE", "Saving did not return a valid version.", 503);
  const version = mapVersion(data.version);
  return { replayed: Boolean(data.replayed), version: { id: version.id, number: version.number }, files, documentSha: sha, ...(data.artifact ? { artifact: mapArtifact(data.artifact) } : {}) };
}
