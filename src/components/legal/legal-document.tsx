import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import type { ReactNode } from "react";
import { HelpFooter, HelpHeader } from "@/app/help/help-chrome";
import helpStyles from "@/app/help/page.module.css";
import { parseMarkdown, type Block, type Inline } from "@/lib/legal/markdown";
import { LEGAL_DOCUMENTS } from "@/lib/legal/versions";
import styles from "./legal-document.module.css";

type LegalFile = typeof LEGAL_DOCUMENTS[number]["file"];

/** Read at build time: the pages are static, so the Markdown in docs/legal is the single source. */
export function legalBlocks(file: LegalFile) {
  return parseMarkdown(readFileSync(path.join(process.cwd(), "docs", "legal", file), "utf8"));
}

function Text({ parts }: { parts: Inline[] }) {
  return <>{parts.map((part, index) => part.kind === "bold" ? <strong key={index}>{part.text}</strong>
    : part.kind === "link" ? (part.href.startsWith("/") ? <Link key={index} href={part.href}>{part.text}</Link> : <a key={index} href={part.href}>{part.text}</a>)
    : part.text)}</>;
}

function render(block: Block, index: number) {
  if (block.kind === "heading") {
    if (block.level === 1) return <h1 key={index}>{block.text}</h1>;
    return block.level === 2 ? <h2 key={index} id={block.id}>{block.text}</h2> : <h3 key={index} id={block.id}>{block.text}</h3>;
  }
  if (block.kind === "list") return <ul key={index}>{block.items.map((item, i) => <li key={i}><Text parts={item} /></li>)}</ul>;
  if (block.kind === "table") {
    const hasHead = block.head.some(cell => cell.some(part => part.text.trim()));
    return <div key={index} className={styles.tableWrap}><table>
      {hasHead && <thead><tr>{block.head.map((cell, i) => <th key={i} scope="col"><Text parts={cell} /></th>)}</tr></thead>}
      <tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, i) => hasHead || i > 0 ? <td key={i}><Text parts={cell} /></td> : <th key={i} scope="row"><Text parts={cell} /></th>)}</tr>)}</tbody>
    </table></div>;
  }
  const meta = index === 1 && block.inline.length === 1 && /^Last updated /.test(block.inline[0].text);
  return <p key={index} className={meta ? styles.meta : undefined}><Text parts={block.inline} /></p>;
}

export default function LegalDocument({ file, children }: { file: LegalFile; children?: ReactNode }) {
  const blocks = legalBlocks(file);
  return <div className={helpStyles.page}>
    <HelpHeader />
    <main className={helpStyles.main} id="main">
      <article className={styles.doc}>
        {blocks.map(render)}
        {children}
        <nav className={styles.links} aria-label="Legal documents">{LEGAL_DOCUMENTS.map(doc => <Link key={doc.path} href={doc.path}>{doc.title}</Link>)}<Link href="/billing/terms">Subscription, credit and refund terms</Link><Link href="/withdraw">Withdraw from a purchase</Link></nav>
      </article>
    </main>
    <HelpFooter />
  </div>;
}

export { styles as legalStyles };
