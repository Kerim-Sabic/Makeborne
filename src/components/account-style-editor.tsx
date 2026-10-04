"use client";
import { useState } from "react";
import { StyleProfileSchema, type ArtifactContent, type StyleProfile } from "@/lib/domain";
import Image from "next/image";
import { templateDirections } from "@/lib/template-directions";
import { accountStyleFromStudio } from "@/lib/cloud/editor-bridge";

export default function AccountStyleEditor({ style, kind, disabled, onChange }: { style: StyleProfile; kind: ArtifactContent["kind"]; disabled: boolean; onChange: (style: StyleProfile) => void }) {
  const [error, setError] = useState("");
  const choices = templateDirections.filter(item => item.kind === kind);
  return <details className="account-style-editor">
    <summary>Design direction <span>{style.name}</span></summary>
    <p className="small-note">Change colours and typography. Your content stays in place; previous designs remain in version history.</p>
    <fieldset disabled={disabled}>
      <legend>Choose a direction</legend>
      <div className="account-style-options">{choices.map(({ id, style: choice }) => <button key={choice.id} type="button" aria-pressed={style.id === choice.id} onClick={() => { setError(""); onChange(accountStyleFromStudio(choice)); }}>
        <span className="account-style-image"><Image src={`/gallery/${id}.png`} alt="" fill sizes="(max-width: 600px) 42vw, 220px" /></span>
        <strong>{choice.name}</strong><small>{choice.description}</small>
      </button>)}</div>
    </fieldset>
    <form key={JSON.stringify(style)} onSubmit={event => {
      event.preventDefault(); if (disabled) return;
      const data = new FormData(event.currentTarget);
      const parsed = StyleProfileSchema.safeParse({ ...style, id: "custom", name: data.get("name"), version: style.version + 1, typography: { ...style.typography, headingFont: data.get("headingFont") }, colors: { ...style.colors, accent: data.get("accent"), ink: data.get("ink"), canvas: data.get("canvas") } });
      if (!parsed.success) { setError("Enter a style name and valid colours."); return; }
      setError(""); onChange(parsed.data);
    }}>
      <fieldset disabled={disabled}>
        <legend>Make it your own</legend>
        <div className="account-style-fields">
          <label>Style name<input name="name" defaultValue={style.name} maxLength={120} required /></label>
          <label>Heading type<select name="headingFont" defaultValue={style.typography.headingFont}>
            {[...new Set([style.typography.headingFont, "Source Serif 4", "Inter", "Georgia", "Arial"])].map(font => <option key={font}>{font}</option>)}
          </select></label>
          {([['canvas', 'Background'], ['ink', 'Text'], ['accent', 'Accent']] as const).map(([key, label]) => <label key={key}>{label}<input type="color" name={key} defaultValue={style.colors[key] ?? (key === 'canvas' ? '#F8F7F4' : '#16181D')} /></label>)}
        </div>
        <button className="button secondary small" type="submit">Apply custom style</button>
      </fieldset>
    </form>
    {disabled && <p className="small-note">Design changes are unavailable while this project is read-only or needs save reconciliation.</p>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
