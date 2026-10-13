/** CSV import and export for clients. Pure functions, no browser APIs. */

export type ImportedClient = { name: string; company: string; email: string; website: string; notes: string; profileUrl: string; tags: string[] };
type ImportField = keyof Omit<ImportedClient, "tags"> | "tags";
export const MAX_IMPORT_ROWS = 500;

/** Spreadsheet apps run cells that start with these as formulas; prefix them so exported data stays data. */
const FORMULA = /^[=+\-@\t\r]/;
function cell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function toCsv(header: string[], rows: unknown[][]) {
  // Byte-order mark so Excel reads accents (č, ć, ž, š, đ) correctly.
  return `﻿${[header, ...rows].map(row => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** RFC 4180 parsing: quoted fields, escaped quotes, commas/newlines inside quotes; also accepts semicolon-separated files. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(field); field = "";
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

const HEADERS: Record<ImportField, RegExp> = {
  profileUrl: /^(instagram|ig|insta|profile|profile ?url|profile ?link|handle|username|tiktok|youtube|social|social ?link)$/i,
  tags: /^(tags?|labels?|segments?|lists?)$/i,
  name: /^(name|full ?name|client|client ?name|contact|contact ?name|ime|ime i prezime)$/i,
  company: /^(company|organi[sz]ation|business|firm|brand|firma|kompanija)$/i,
  email: /^(e-?mail|email ?address|mail)$/i,
  website: /^(website|web ?site|url|site|web|link)$/i,
  notes: /^(notes?|comments?|description|biljeske|bilješke)$/i,
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "@maya.plants" or "maya.plants" → a profile link (Instagram unless the column names TikTok or YouTube); full links pass through. */
export function profileLink(raw: string, column: string) {
  const value = raw.trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(www\.)?(instagram|tiktok|youtube)\.com\//i.test(value)) return `https://${value}`;
  const handle = value.replace(/^@/, "");
  if (!/^[\w.]{1,40}$/.test(handle)) return "";
  return /tiktok/i.test(column) ? `https://www.tiktok.com/@${handle}` : /youtube/i.test(column) ? `https://www.youtube.com/@${handle}` : `https://www.instagram.com/${handle}/`;
}

/** Maps parsed rows to clients. The first row must name the columns; only a name is required. */
export function mapImport(rows: string[][]): { clients: ImportedClient[]; skipped: { row: number; reason: string }[]; columns: Partial<Record<ImportField, string>> } {
  const [header = [], ...data] = rows;
  const index: Partial<Record<ImportField, number>> = {}, columns: Partial<Record<ImportField, string>> = {};
  header.forEach((title, at) => {
    const clean = title.trim();
    for (const key of Object.keys(HEADERS) as ImportField[]) if (index[key] === undefined && HEADERS[key].test(clean)) { index[key] = at; columns[key] = clean; }
  });
  if (index.name === undefined) {
    // "First name" + "Last name" columns combine into the name.
    const first = header.findIndex(title => /^(first ?name|given ?name)$/i.test(title.trim())), last = header.findIndex(title => /^(last ?name|surname|family ?name)$/i.test(title.trim()));
    if (first >= 0) {
      columns.name = last >= 0 ? `${header[first].trim()} + ${header[last].trim()}` : header[first].trim();
      data.forEach(row => row.splice(header.length, 0, [row[first] ?? "", last >= 0 ? row[last] ?? "" : ""].join(" ").trim()));
      index.name = header.length;
    }
  }
  const clients: ImportedClient[] = [], skipped: { row: number; reason: string }[] = [];
  if (index.name === undefined && index.profileUrl === undefined) return { clients, skipped: [{ row: 1, reason: "No name or Instagram/profile column found. Add a header row with one of them." }], columns };
  const seen = new Set<string>();
  data.forEach((row, at) => {
    const value = (key: ImportField, max: number) => (index[key] === undefined ? "" : (row[index[key]!] ?? "").trim()).slice(0, max);
    const client = { name: value("name", 120), company: value("company", 160), email: value("email", 254).toLowerCase(), website: value("website", 500), notes: value("notes", 4000),
      profileUrl: profileLink(value("profileUrl", 300), columns.profileUrl ?? ""), tags: value("tags", 400).split(/[;|,]/).map(tag => tag.trim().slice(0, 30)).filter(Boolean).slice(0, 12) };
    // No name but a profile: use the handle as the name (rename later).
    if (!client.name && client.profileUrl) client.name = (/(?:instagram\.com|tiktok\.com|youtube\.com)\/@?([\w.]+)/i.exec(client.profileUrl)?.[1] ?? "").slice(0, 120);
    const line = at + 2;
    if (!client.name) { skipped.push({ row: line, reason: "No name" }); return; }
    if (client.email && !EMAIL.test(client.email)) { skipped.push({ row: line, reason: `Invalid email "${client.email}"` }); return; }
    if (client.website && !/^https?:\/\//i.test(client.website)) client.website = `https://${client.website}`;
    const key = client.email || `${client.name.toLowerCase()}|${client.company.toLowerCase()}`;
    if (seen.has(key)) { skipped.push({ row: line, reason: "Duplicate in this file" }); return; }
    if (clients.length >= MAX_IMPORT_ROWS) { skipped.push({ row: line, reason: `Over the ${MAX_IMPORT_ROWS}-client import limit` }); return; }
    seen.add(key); clients.push(client);
  });
  return { clients, skipped, columns };
}
