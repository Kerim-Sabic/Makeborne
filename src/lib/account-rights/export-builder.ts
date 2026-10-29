import JSZip from "jszip";
import { createHash } from "node:crypto";
import { toCsv } from "../client-csv";
import { EXPORT_FILE_BUDGET_BYTES, EXPORT_PART_BYTES, SUPPORT_EMAIL } from "./contracts";
import { EXPORT_SOURCES, exportCsvName, exportFileName, type ExportSource } from "./export-sources";

/**
 * Builds the ZIP parts of one account export. Pure orchestration over injected
 * readers so it runs offline in tests: `rows` is the scoped database read, `download`
 * reads one uploaded file, `websiteSources` returns prepared source bundles.
 * Part 1 always holds the README, manifest, every JSON/CSV file and website sources;
 * uploaded files follow in as many parts as needed.
 */
export type ExportDeps = {
  rows(source: string, offset: number, limit: number): Promise<unknown[]>;
  download(objectPath: string): Promise<Uint8Array | null>;
  websiteSources?(): Promise<{ name: string; bytes: Uint8Array }[]>;
  now(): Date;
};
export type ExportOptions = { partBytes?: number; fileBudgetBytes?: number; sources?: readonly ExportSource[]; maxRows?: number };
export type BuiltExport = {
  parts: { part: number; bytes: Uint8Array; sha256: string }[];
  summary: Record<string, number>;
  files: { included: number; skipped: number; missing: number; bytes: number };
};

// Defence in depth: the database never selects these, and the builder drops any that appear.
const SECRET_KEY = /(^|_)(access|refresh|provider|session|api)?_?(token|secret|ciphertext|password|cookie)s?(_hash)?$|^token_hash$|_ciphertext$|^cookie_hash$/i;
export function withoutSecrets(value: unknown, depth = 0): unknown {
  if (depth > 40) return null;
  if (Array.isArray(value)) return value.map(item => withoutSecrets(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) if (!SECRET_KEY.test(key)) out[key] = withoutSecrets(item, depth + 1);
    return out;
  }
  return value;
}

const safeSegment = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/\.{2,}/g, ".").replace(/^[.-]+/, "").slice(0, 80) || "file";
/** Path inside the ZIP for one uploaded file; never escapes its folder. */
export function exportFilePath(asset: { id: string; workspace_id: string; project_id: string; object_path: string }) {
  const base = asset.object_path.split("/").pop() ?? "file";
  return `files/${safeSegment(asset.workspace_id)}/${safeSegment(asset.project_id)}/${safeSegment(asset.id)}-${safeSegment(base)}`;
}
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const cellValue = (value: unknown) => value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : value;

function readme(generatedAt: string, parts: number, files: BuiltExport["files"]) {
  return [
    "Your Makeborne data",
    `Prepared ${generatedAt} (UTC).`,
    "",
    "What's inside",
    "- data/: everything saved to your account, as JSON: your profile and sign-in methods, workspaces you own and",
    "  workspaces you belong to, clients, contacts, notes and follow-ups, projects with every saved version, styles,",
    "  brand kits, client reviews and comments, published websites, form enquiries, connected mailboxes and the emails",
    "  saved in your workspaces, your project chat history, plans, payments, credits and usage, and your consents.",
    "- spreadsheets/: the same clients, contacts, tasks, projects, comments, enquiries, emails, payments and credit",
    "  history as CSV files that open in a spreadsheet.",
    "- files/: the original files you uploaded, by workspace and project.",
    "- website-sources/: a source download of the current version of each generated website, where available.",
    "- manifest.json: row counts per file and a checksum for every uploaded file.",
    "",
    "What's not inside",
    "- Passwords, sign-in tokens, mailbox and code-hosting access keys, and private review or invitation links.",
    "- Private data of other accounts, such as their chat history or billing, including in workspaces you share.",
    "- Content of workspaces you belong to but don't own; ask that workspace's owner for a copy.",
    "- Internal cost figures and fraud-prevention signals.",
    "",
    files.skipped ? `${files.skipped} uploaded file(s) exceeded the size included in one export and are listed in manifest.json; email ${SUPPORT_EMAIL} for a copy.` : "All uploaded files we could read are included.",
    files.missing ? `${files.missing} uploaded file(s) could not be read from storage and are marked missing in manifest.json.` : "",
    parts > 1 ? `This export has ${parts} parts. Keep them together; part 1 holds this file and all your records.` : "",
    "",
    `Questions: ${SUPPORT_EMAIL}`,
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\r\n");
}

export async function buildAccountExport(deps: ExportDeps, options: ExportOptions = {}): Promise<BuiltExport> {
  const partBytes = options.partBytes ?? EXPORT_PART_BYTES, budget = options.fileBudgetBytes ?? EXPORT_FILE_BUDGET_BYTES;
  const sources = options.sources ?? EXPORT_SOURCES, maxRows = options.maxRows ?? 200_000;
  const generatedAt = deps.now().toISOString();
  const first = new JSZip();
  const summary: Record<string, number> = {};
  const data = new Map<string, unknown[]>();
  for (const source of sources) {
    const rows: unknown[] = [];
    for (let offset = 0; ; offset += source.page) {
      const page = await deps.rows(source.source, offset, source.page);
      if (!Array.isArray(page)) throw Object.assign(new Error("EXPORT_SOURCE_INVALID"), { code: "EXPORT_SOURCE_INVALID" });
      rows.push(...page.map(row => withoutSecrets(row)));
      if (page.length < source.page || source.page === 1) break;
      if (rows.length > maxRows) throw Object.assign(new Error("EXPORT_TOO_LARGE"), { code: "EXPORT_TOO_LARGE" });
    }
    summary[source.source] = rows.length;
    data.set(source.source, rows);
    if (source.optional && rows.length === 0) continue;
    first.file(exportFileName(source), JSON.stringify(rows, null, 2));
    if (source.csv) {
      const records = rows as Record<string, unknown>[];
      first.file(exportCsvName(source), toCsv([...source.csv], records.map(row => source.csv!.map(column => cellValue(row[column])))));
    }
  }

  const fileIndex: { path: string; part: number | null; bytes: number; sha256: string | null; status: "included" | "skipped" | "missing" }[] = [];
  const files = { included: 0, skipped: 0, missing: 0, bytes: 0 };
  let total = 0;
  if (deps.websiteSources) {
    for (const bundle of await deps.websiteSources()) {
      if (total + bundle.bytes.byteLength > budget) { files.skipped++; continue; }
      total += bundle.bytes.byteLength;
      first.file(`website-sources/${safeSegment(bundle.name)}`, bundle.bytes, { compression: "STORE" });
    }
  }

  // Uploaded files: fill parts in order, never above the part size.
  const zips: JSZip[] = [first];
  let current = first, currentBytes = 0;
  const assets = (data.get("assets") ?? []) as { id: string; workspace_id: string; project_id: string; object_path: string }[];
  for (const asset of assets) {
    const path = exportFilePath(asset);
    const bytes = await deps.download(asset.object_path);
    if (!bytes) { files.missing++; fileIndex.push({ path, part: null, bytes: 0, sha256: null, status: "missing" }); continue; }
    if (total + bytes.byteLength > budget || bytes.byteLength > partBytes) {
      files.skipped++; fileIndex.push({ path, part: null, bytes: bytes.byteLength, sha256: sha256(bytes), status: "skipped" }); continue;
    }
    if (currentBytes + bytes.byteLength > partBytes && currentBytes > 0) { current = new JSZip(); zips.push(current); currentBytes = 0; }
    current.file(path, bytes, { compression: "STORE" });
    currentBytes += bytes.byteLength; total += bytes.byteLength;
    files.included++; files.bytes += bytes.byteLength;
    fileIndex.push({ path, part: zips.length, bytes: bytes.byteLength, sha256: sha256(bytes), status: "included" });
  }

  first.file("manifest.json", JSON.stringify({ format: "makeborne-account-export", version: 1, generatedAt, parts: zips.length,
    records: summary, files: fileIndex }, null, 2));
  first.file("README.txt", readme(generatedAt, zips.length, files));
  const parts: BuiltExport["parts"] = [];
  for (const [index, zip] of zips.entries()) {
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
    parts.push({ part: index + 1, bytes, sha256: sha256(bytes) });
  }
  return { parts, summary, files };
}
