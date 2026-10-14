"use client";
import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, PlayCircle, Search, X } from "lucide-react";
import DemoPlayer from "./player";
import { searchHelp } from "@/lib/help/search";
import type { DemoId } from "./scripts";

const EXAMPLES = ["How do I find new leads?", "Make a presentation", "Send personal emails", "Publish my website", "How do credits work?"];

/** "Ask how to do something": instant answers from the help articles, and a pre-made demo that shows it. No AI. */
export default function HelpAsk() {
  const [query, setQuery] = useState("");
  const [showing, setShowing] = useState<DemoId | null>(null);
  const deferred = useDeferredValue(query);
  const results = useMemo(() => searchHelp(deferred), [deferred]);
  const top = results[0];
  return <div className="ha">
    <label className="ha-box"><Search size={18} aria-hidden="true" />
      <input value={query} onChange={event => { setQuery(event.target.value); setShowing(null); }} placeholder="Ask how to do something, e.g. how do I find new leads?" aria-label="Search the help center" maxLength={160} />
      {query && <button type="button" onClick={() => { setQuery(""); setShowing(null); }} aria-label="Clear search"><X size={16} /></button>}
    </label>
    {!query && <div className="ha-examples" aria-label="Example questions">{EXAMPLES.map(example => <button type="button" key={example} onClick={() => setQuery(example)}>{example}</button>)}</div>}
    {query && <div className="ha-results" aria-live="polite">
      {top ? <>
        <article className="ha-top">
          <h2>{top.title}</h2>
          <p>{top.answer}</p>
          <div className="ha-actions">
            {top.demo && <button type="button" className="ha-show" onClick={() => setShowing(showing === top.demo ? null : top.demo!)}><PlayCircle size={16} />{showing === top.demo ? "Hide the demo" : "Show me"}</button>}
            <Link href={`/help/${top.slug}`}>Read the step-by-step guide <ArrowRight size={14} /></Link>
          </div>
          {showing && showing === top.demo && <div className="ha-demo"><DemoPlayer key={showing} id={showing} compact /></div>}
        </article>
        {results.length > 1 && <ul className="ha-more">{results.slice(1).map(article => <li key={article.slug}><Link href={`/help/${article.slug}`}>{article.title}<ArrowRight size={13} /></Link></li>)}</ul>}
      </> : <p className="ha-none">No guide matches that yet. Try other words, or email <a href="mailto:admin@makeborne.com">admin@makeborne.com</a>.</p>}
    </div>}
  </div>;
}

/** Popular demos behind tabs on the help home. */
export function DemoGallery({ items }: { items: { id: DemoId; label: string }[] }) {
  const [active, setActive] = useState(items[0].id);
  return <div className="hg">
    <div className="hg-tabs" role="tablist" aria-label="Choose a demo">{items.map(item => <button type="button" role="tab" key={item.id} aria-selected={active === item.id} onClick={() => setActive(item.id)}>{item.label}</button>)}</div>
    <DemoPlayer key={active} id={active} />
  </div>;
}
