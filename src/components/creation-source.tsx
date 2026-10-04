"use client";
import { useId } from "react";
import type { Kind } from "./studio-model";

const choices = [
  { value: "preserve", title: "Keep my words", description: "Keep each passage as written." },
  { value: "improve", title: "Polish the writing", description: "Refine clarity and flow." },
  { value: "summarise", title: "Make it concise", description: "Condense the main ideas." },
] as const;

export default function CreationSource({ kind, content, wording, onContent, onWording }: {
  kind: Kind; content: string; wording: string; onContent: (value: string) => void; onWording: (value: string) => void;
}) {
  const id = useId();
  const label = kind === "presentation" ? "Slide text or notes" : kind === "book" ? "Manuscript or notes" : "Website copy or notes";
  return <details className="prompt-options prompt-source">
    <summary><span>Add your content <small>Text, notes or a draft</small></span><span>{content.trim() ? "Text added" : "Optional"}</span></summary>
    <p className="prompt-source-intro">{kind === "presentation" ? "Bring your slide copy, an outline, or rough notes." : kind === "book" ? "Start with a manuscript, chapter outline, or your own notes." : "Bring your business description, page copy, or project notes."} You can also leave this empty and start from your idea.</p>
    <label htmlFor={`${id}-text`}>{label}</label>
    <textarea id={`${id}-text`} aria-describedby={`${id}-note`} value={content} onChange={event => onContent(event.target.value)} maxLength={50000} rows={6} placeholder={kind === "presentation" ? "Paste your talking points, slide text, or the story you want to tell…" : kind === "book" ? "Paste your draft, chapter notes, or the material you want to build on…" : "Paste the copy or details you want your website to include…"} />
    <div className="prompt-source-meta" id={`${id}-note`}><span>Your text is saved with the project.</span><span>{content.length.toLocaleString()} / 50,000</span></div>
    <fieldset className="prompt-wording"><legend>How should your writing be treated?</legend>
      <div className="prompt-wording-options">{choices.map(choice => <label className="prompt-wording-choice" key={choice.value}>
        <input type="radio" name={`${id}-wording`} value={choice.value} checked={wording === choice.value} onChange={() => onWording(choice.value)} />
        <span><strong>{choice.title}</strong><small>{choice.description}</small></span>
      </label>)}</div>
    </fieldset>
    <p className="prompt-source-footnote">This records your preference for generation. Protected content stays unchanged in every mode.</p>
  </details>;
}
