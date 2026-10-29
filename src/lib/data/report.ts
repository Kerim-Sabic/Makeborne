import { z } from "zod";
import type { ExtractionRecord } from "../ingest/record";
import { buildDataset, DatasetOptionsSchema, type Dataset } from "./dataset";
import { computeFacts, detectRoles, ReportOptionsSchema, RolesSchema, TEMPLATE_IDS, TEMPLATES, type Roles, type TemplateId } from "./templates";
import type { FactsSheet } from "./facts";

/**
 * One data report request, from the browser: which stored spreadsheet, which
 * task, and optional overrides (sheet, header row, column types and formats,
 * column roles, how to treat mixed currencies). The numbers are always
 * recomputed on the server from the stored source; the browser never supplies
 * a figure. Generation additionally names the version it expects to replace
 * and the facts digest the person saw in the preview.
 */
export const MAKEBORNE_DATA_REPORTS_FLAG = "MAKEBORNE_DATA_REPORTS";
export function dataReportsEnabled(env: Record<string, string | undefined> = process.env) { return env[MAKEBORNE_DATA_REPORTS_FLAG] === "on"; }

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const ReportRequestSchema = z.object({
  source: z.object({ assetId: z.string().uuid(), sha256 }).strict(),
  template: z.enum(TEMPLATE_IDS),
  dataset: DatasetOptionsSchema.default({}),
  roles: RolesSchema.default({}),
  options: ReportOptionsSchema.default({ mixedCurrency: "refuse" }),
}).strict();
export const GenerateRequestSchema = ReportRequestSchema.extend({
  expectedVersion: z.number().int().positive(), actionKey: z.string().uuid(), expectedFactsDigest: sha256,
  mode: z.enum(["replace", "append"]).default("replace"), title: z.string().trim().min(1).max(160).optional(),
  /** "plain": the summary written from the numbers. "ai": an AI-written summary, refused until that task kind is qualified. */
  narrative: z.enum(["plain", "ai"]).default("plain"),
}).strict();
export type ReportRequest = z.infer<typeof ReportRequestSchema>;
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

export type Prepared = { dataset: Dataset; roles: Roles; detected: Roles; facts: FactsSheet };
/** Dataset → roles (detected, then the person's overrides) → facts sheet. Pure and deterministic. */
export function prepareReport(record: ExtractionRecord, request: ReportRequest, sourceName?: string): Prepared {
  const dataset = buildDataset(record, request.dataset);
  // Part of the sealed facts (and their digest): which stored file, under which name.
  Object.assign(dataset.source, { assetId: request.source.assetId }, sourceName ? { name: sourceName } : {});
  const detected = detectRoles(request.template, dataset);
  const roles = { ...detected, ...request.roles };
  // An explicitly cleared optional role arrives as an empty list.
  for (const [role, value] of Object.entries(roles)) if (Array.isArray(value) && !value.length && !TEMPLATES[request.template].roles.find(item => item.role === role)?.multiple) delete roles[role];
  const facts = computeFacts({ template: request.template, dataset, roles, options: request.options });
  return { dataset, roles, detected, facts };
}

/** What the preview shows: the computed figures with their cells, the column reading, missing values and warnings. */
export function previewView(prepared: Prepared) {
  const { dataset, facts } = prepared;
  return {
    template: facts.template, title: facts.title, digest: facts.digest, period: facts.period ?? null,
    sheet: dataset.source.sheet, sheets: dataset.source.sheets, headerRow: dataset.headerRow, rows: dataset.rows.length,
    columns: dataset.columns.map(column => ({ letter: column.letter, header: column.header, kind: column.kind, kindSource: column.kindSource,
      ...(column.currency ? { currency: column.currency, currencySource: column.currencySource } : {}), ...(column.unit ? { unit: column.unit } : {}),
      ...(column.dateFormat ? { dateFormat: column.dateFormat } : {}), ...(column.decimal ? { decimal: column.decimal } : {}),
      values: column.counts.values, missing: column.counts.missing, formulas: column.counts.formulas, suggestions: column.suggestions })),
    roles: prepared.roles, detected: prepared.detected,
    facts: facts.facts.map(fact => ({ id: fact.id, label: fact.label, display: fact.display, value: fact.value, ...(fact.currency ? { currency: fact.currency } : {}), ...(fact.unit ? { unit: fact.unit } : {}),
      n: fact.n, refs: fact.refs, ...(fact.missing ? { missing: fact.missing } : {}), ...(fact.denominator ? { denominator: fact.denominator } : {}), method: fact.method, ...(fact.rounding ? { rounding: fact.rounding } : {}) })),
    sections: facts.sections, charts: facts.charts.map(chart => ({ id: chart.id, title: chart.title, type: chart.chart.type, points: chart.points.length })),
    issues: facts.issues.slice(0, 200), issueCount: facts.issues.length, warnings: facts.warnings,
  };
}
export type PreviewView = ReturnType<typeof previewView>;
export const templateFor = (id: TemplateId) => TEMPLATES[id];
