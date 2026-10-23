import { createHash } from "node:crypto";
import { auditSite, readSiteContent, type AuditFinding } from "../leads/redesign";

/**
 * Pure extraction of one public page into bounded, citable data (no network).
 * - Hidden content (hidden/aria-hidden elements, inline display:none,
 *   visibility:hidden, zero-size text) is removed before anything is read.
 * - Sentences addressed to automated tools ("ignore previous instructions",
 *   "you are an AI", "send an email to…") are removed from the citable text
 *   and counted, so they can never be quoted as a fact or reach a model as
 *   anything but a count.
 * - Signals the page shows to a visitor (secure connection, phone layout,
 *   enquiry form, tap-to-call, footer year, theme colour, fonts, logo) are
 *   written as one plain line, so strengths/shortcomings cite real text.
 */
export type PageData = {
  title: string; description: string; siteName: string;
  headings: string[]; paragraphs: string[]; items: string[];
  phones: string[]; emails: string[]; address: string; hours: string[];
  nav: { label: string; url: string }[]; externalLinks: string[];
  signals: string; audit: AuditFinding[];
  flags: { injection: number; hidden: number; login: boolean; blocked: boolean };
  words: number;
  /** Everything a citation may quote, in reading order (bounded). */
  text: string;
};
export const MAX_PAGE_TEXT = 12_000;

const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d]*[1-9])|opacity\s*:\s*0(?![.\d]*[1-9])|(?:^|;)\s*(?:width|height)\s*:\s*0(?:px)?\s*(?:;|$)/i;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const hiddenAttrs = (attrs: string) => {
  const style = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  return /\shidden(?:\s|=|\/|$)/i.test(attrs) || /\saria-hidden\s*=\s*["']?true/i.test(attrs) || Boolean(style && HIDDEN_STYLE.test(style[1] ?? style[2] ?? ""));
};
/** Elements a visitor cannot see, removed with everything inside them (depth-matched, bounded work). */
export function stripHidden(html: string): { html: string; removed: number } {
  const source = html.replace(/<!--[\s\S]*?-->/g, " ");
  const opening = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let out = "", from = 0, removed = 0, match: RegExpExecArray | null;
  while ((match = opening.exec(source)) && removed < 500) {
    const tag = match[1].toLowerCase();
    if (VOID.has(tag) || match[2].trimEnd().endsWith("/") || !hiddenAttrs(match[2])) continue;
    // Find the matching close tag, counting nested elements of the same name.
    const scan = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    scan.lastIndex = opening.lastIndex;
    let depth = 1, end = source.length, next: RegExpExecArray | null;
    while (depth > 0 && (next = scan.exec(source))) {
      depth += next[1] ? -1 : next[0].trimEnd().endsWith("/>") ? 0 : 1;
      if (depth === 0) end = scan.lastIndex;
    }
    out += `${source.slice(from, match.index)} `;
    from = end; opening.lastIndex = end; removed++;
  }
  return { html: out + source.slice(from), removed };
}

/** Text addressed to an automated reader rather than a visitor. */
export const INJECTION_PATTERN = /\b(ignore|disregard|forget|override)\b[^.!?\n]{0,40}\b(instructions?|prompts?|rules|guidelines|directions)\b|\bsystem prompt\b|\b(you are|act as) (now )?(an? )?(ai|assistant|chatbot|language model|llm)\b|\bas an ai\b|^\s*(system|assistant|developer)\s*:|\bnew instructions?\b|\bjailbreak\b|\b(ai|assistants?|models?|agents?|bots?|crawlers?)\b[^.!?\n]{0,40}\b(must|should|are required to|will now)\b|\b(api[ _-]?key|access token|secret key)\b|\bapprove (every|all) (facts?|items?)\b|\b(raise|increase|set)\b[^.!?\n]{0,20}\b(budget|credits?|spending limit)\b/im;
export function isInjection(text: string) { return INJECTION_PATTERN.test(text); }

const clean = (value: string) => value.replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, " ").replace(/\s+/g, " ").trim();
function keep(values: readonly string[], counter: { injection: number }) {
  const out: string[] = [];
  for (const value of values) {
    const sentences = clean(value).split(/(?<=[.!?])\s+/).filter(Boolean);
    const safe = sentences.filter(sentence => { if (isInjection(sentence)) { counter.injection++; return false; } return true; });
    if (safe.length) out.push(safe.join(" "));
  }
  return out;
}

function meta(html: string, name: string) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\s(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (key === name) return clean(/\scontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "");
  }
  return "";
}

function signalsOf(html: string, finalUrl: URL, audit: readonly AuditFinding[]) {
  const has = (id: string) => audit.some(item => item.id === id);
  const year = audit.find(item => item.id === "dated")?.detail.match(/© (\d{4})/)?.[1];
  const theme = /^#[0-9a-f]{3,8}$/i.test(meta(html, "theme-color")) ? meta(html, "theme-color") : "";
  const fonts = [...new Set([...html.matchAll(/fonts\.googleapis\.com\/css2?\?[^"'>]*family=([^"'&>:]+)/gi)].map(match => decodeURIComponent(match[1]).replace(/\+/g, " ").trim()))].slice(0, 3);
  const logo = /<img\b[^>]*(?:src|alt|class)\s*=\s*["'][^"']*logo/i.test(html);
  const parts = [
    `Secure connection: ${/^https:$/.test(finalUrl.protocol) ? "yes" : "no"}`,
    `Phone layout: ${has("mobile") ? "no" : "yes"}`,
    `Enquiry form: ${has("form") ? "no" : "yes"}`,
    `Tap-to-call: ${/href=["']tel:/i.test(html) ? "yes" : "no"}`,
    `Clear next step: ${has("cta") ? "no" : "yes"}`,
    `Main headline: ${has("h1") ? "no" : "yes"}`,
    `Search description: ${has("description") ? "no" : "yes"}`,
    ...(year ? [`Footer year: ${year}`] : []),
    ...(theme ? [`Theme colour: ${theme}`] : []),
    ...(fonts.length ? [`Fonts: ${fonts.join(", ")}`] : []),
    `Logo image: ${logo ? "yes" : "no"}`,
  ];
  return `Signals: ${parts.join(". ")}.`;
}

/** Extracts one page. `finalUrl` is where the bytes came from (after redirects). */
export function extractPage(rawHtml: string, finalUrl: URL, now?: Date): PageData {
  const { html, removed } = stripHidden(rawHtml);
  const content = readSiteContent(html, finalUrl);
  const counter = { injection: 0 };
  const title = keep([content.title], counter)[0] ?? "";
  const description = keep([content.description], counter)[0] ?? "";
  const siteName = keep([meta(html, "og:site_name")], counter)[0] ?? "";
  const headings = keep(content.headings, counter).slice(0, 24);
  const paragraphs = keep(content.paragraphs, counter).slice(0, 20);
  const items = keep(content.items, counter).slice(0, 30);
  const audit = auditSite({ html: rawHtml, finalUrl: finalUrl.href, content, now });
  const signals = signalsOf(rawHtml, finalUrl, audit);
  const login = /<input\b[^>]*type\s*=\s*["']?password/i.test(html) && content.words < 250 || /\/(log-?in|sign-?in|account\/login)(\/|$)/i.test(finalUrl.pathname);
  // Bot checks and consent walls have no title, description or text.
  const blocked = !title && !description && content.words < 20;
  const host = finalUrl.hostname.replace(/^www\./, "");
  const externalLinks = [...new Set([...rawHtml.matchAll(/href\s*=\s*["'](https?:\/\/[^"'#\s>]+)["']/gi)].map(match => {
    try { const url = new URL(match[1]); return url.hostname.replace(/^www\./, "") === host ? "" : `${url.protocol}//${url.hostname}`; } catch { return ""; }
  }).filter(Boolean))].slice(0, 30);
  const lines = [
    title && `Title: ${title}`, description && `Description: ${description}`, siteName && `Site name: ${siteName}`,
    ...headings.map(item => `Heading: ${item}`), ...paragraphs, ...items.map(item => `Item: ${item}`),
    ...content.phones.map(item => `Phone: ${clean(item)}`), ...content.emails.map(item => `Email: ${item}`),
    content.address && `Address: ${clean(content.address)}`, ...content.hours.map(item => `Hours: ${clean(item)}`), signals,
  ].filter(Boolean) as string[];
  let text = "";
  for (const line of lines) { if (text.length + line.length + 1 > MAX_PAGE_TEXT) break; text += `${line}\n`; }
  return { title, description, siteName, headings, paragraphs, items, phones: content.phones.map(clean), emails: content.emails, address: clean(content.address), hours: content.hours.map(clean),
    nav: content.nav, externalLinks, signals, audit, flags: { injection: counter.injection, hidden: removed, login, blocked }, words: content.words, text: text.trim() };
}

export const sha256Hex = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

// ---------- robots.txt ----------
export type RobotsRules = { allow: string[]; disallow: string[] };
/** The rules for our reader (MakeborneResearch) or, failing that, for every reader ("*"). */
export function parseRobots(text: string, agent = "makeborneresearch"): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: (typeof groups)[number] | null = null, lastWasAgent = false;
  for (const raw of text.split(/\r?\n/).slice(0, 2000)) {
    const line = raw.replace(/#.*/, "").trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase(), value = match[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], allow: [], disallow: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase()); lastWasAgent = true; continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" && value) current.allow.push(value);
    if (field === "disallow" && value) current.disallow.push(value);
  }
  const own = groups.filter(group => group.agents.some(name => name !== "*" && agent.includes(name)));
  const chosen = own.length ? own : groups.filter(group => group.agents.includes("*"));
  return { allow: chosen.flatMap(group => group.allow), disallow: chosen.flatMap(group => group.disallow) };
}
const ruleMatches = (rule: string, path: string) => {
  const anchored = rule.endsWith("$");
  const pattern = rule.replace(/\$$/, "").split("*").map(part => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(path);
};
/** Longest matching rule wins; Allow wins a tie (RFC 9309). */
export function robotsAllows(rules: RobotsRules, path: string) {
  const longest = (list: string[]) => Math.max(-1, ...list.filter(rule => ruleMatches(rule, path)).map(rule => rule.length));
  const allow = longest(rules.allow), disallow = longest(rules.disallow);
  return disallow < 0 || allow >= disallow;
}
