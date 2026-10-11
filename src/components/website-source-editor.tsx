"use client";

import {useEffect, useEffectEvent, useRef, useState} from "react";
import {basicSetup} from "codemirror";
import {Compartment, EditorState} from "@codemirror/state";
import {EditorView} from "@codemirror/view";
import {javascript} from "@codemirror/lang-javascript";
import {css} from "@codemirror/lang-css";
import {html} from "@codemirror/lang-html";
import {json} from "@codemirror/lang-json";
import {linter, lintGutter} from "@codemirror/lint";
import {syntaxTree} from "@codemirror/language";
import {FileCode2, LockKeyhole, Plus, Search, Trash2} from "lucide-react";
import {editWebsiteSource, managedSourcePath, removableSourcePath} from "@/lib/projects/source-edit";
import type {WebsiteProjectSource} from "@/lib/projects/website-source";
import {sourceSyntaxDiagnostics, type SourceSyntaxReport} from "@/lib/projects/source-diagnostics";
import "@/app/source-editor.css";

const editorTheme = EditorView.theme({
  "&": {height: "100%", fontSize: "13px", color: "#25272f", backgroundColor: "#fff"},
  ".cm-scroller": {overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", lineHeight: "1.7"},
  ".cm-content": {padding: "16px 0"},
  ".cm-gutters": {backgroundColor: "#fafbfc", borderRight: "1px solid #edf0f5", color: "#9a9eaa"},
  ".cm-activeLine, .cm-activeLineGutter": {backgroundColor: "#f4f6fc"},
  "&.cm-focused": {outline: "2px solid #dce3fb", outlineOffset: "-2px"},
});
function language(path: string) {
  path = path.toLowerCase();
  if (/\.[jt]sx?$/.test(path)) return javascript({typescript: /\.tsx?$/.test(path), jsx: /\.[jt]sx$/.test(path)});
  if (/\.css$/.test(path)) return css();
  if (/\.html$/.test(path)) return html();
  if (/\.json$/.test(path)) return json();
  return [];
}

export default function WebsiteSourceEditor({source, readOnly, onChange}: {
  source: WebsiteProjectSource; readOnly: boolean; onChange: (source: WebsiteProjectSource, note: string) => void;
}) {
  const [selected, setSelected] = useState(source.entrypoint as string);
  const [filter, setFilter] = useState("");
  const [newPath, setNewPath] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [syntax, setSyntax] = useState<(SourceSyntaxReport & {path: string; document: string}) | null>(null);
  const file = source.files.find(item => item.path === selected) ?? source.files[0];
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const permissions = useRef(new Compartment());
  const externalChange = useRef(false);
  const locked = readOnly || managedSourcePath(file.path);
  const syntaxSupported = /\.(?:[jt]sx?|css|html|json)$/i.test(file.path) && !managedSourcePath(file.path);
  const currentSyntax = syntax?.path === file.path && syntax.document === file.content ? syntax : null;
  const reportSyntax = useEffectEvent((path: string, report: SourceSyntaxReport, document: string) => setSyntax({...report, path, document}));

  const validate = useEffectEvent((path: string, value: string) => {
    if (readOnly) return false;
    const result = editWebsiteSource(source, {type: "edit", path, content: value});
    if (!result.ok) {queueMicrotask(() => setMessage(result.message)); return false;}
    return true;
  });
  const changed = useEffectEvent((path: string, value: string) => {
    const result = editWebsiteSource(source, {type: "edit", path, content: value});
    if (result.ok && !readOnly) {setMessage(""); onChange(result.source, `Edited ${path}`);}
  });
  useEffect(() => {
    if (!host.current) return;
    const path = file.path;
    const savedStates = states.current;
    const cached = savedStates.get(path);
    const state = cached?.doc.toString() === file.content ? cached : EditorState.create({doc: file.content, extensions: [
      basicSetup, language(path), editorTheme,
      ...(syntaxSupported ? [lintGutter(), linter(view => {
        const report = sourceSyntaxDiagnostics(view.state);
        reportSyntax(path, report, view.state.doc.toString());
        return report.issues.map(issue => ({from: issue.from, to: issue.to, severity: "error" as const, source: "Syntax", message: issue.message}));
      }, {delay: 500, needsRefresh: update => syntaxTree(update.startState) !== syntaxTree(update.state)})] : []),
      permissions.current.of([EditorState.readOnly.of(locked), EditorView.editable.of(!locked)]),
      EditorView.contentAttributes.of({"aria-label": `${path} source`, "aria-multiline": "true"}),
      EditorState.transactionFilter.of(transaction => !transaction.docChanged || externalChange.current || validate(path, transaction.newDoc.toString()) ? transaction : []),
      EditorView.updateListener.of(update => {if (update.docChanged && !externalChange.current) changed(path, update.state.doc.toString());}),
    ]});
    const view = new EditorView({state, parent: host.current});
    editor.current = view;
    return () => {savedStates.set(path, view.state); view.destroy(); editor.current = null;};
    // Document updates and permissions are synchronized without resetting undo history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path]);
  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    view.dispatch({effects: permissions.current.reconfigure([EditorState.readOnly.of(locked), EditorView.editable.of(!locked)])});
  }, [locked, file.path]);
  useEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === file.content) return;
    externalChange.current = true;
    try {view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: file.content}});}
    finally {externalChange.current = false;}
  }, [file.content, file.path]);

  function mutate(operation: Parameters<typeof editWebsiteSource>[1]) {
    if (readOnly) return;
    const result = editWebsiteSource(source, operation);
    if (!result.ok) {setMessage(result.message); return;}
    onChange(result.source, `${operation.type === "add" ? "Added" : "Removed"} ${operation.path}`);
    setSelected(operation.type === "remove" ? source.entrypoint : operation.path);
    setAdding(false); setDeleting(false); setNewPath(""); setFilter(""); setMessage("");
  }
  return <section className="source-editor" aria-label="Website code editor">
    <header className="source-editor-heading"><div><span className="eyebrow">PROJECT SOURCE</span><h3>Your website, in code</h3></div><span className="source-editor-badge">{readOnly ? "Read only" : "Autosave on"}</span></header>
    <p className="source-editor-guidance">Edits save as new versions after you pause. Preview shows the last verified build; editing does not rebuild or publish it. Use History to restore a saved version.</p>
    <div className="source-editor-layout">
      <aside className="source-editor-files" aria-label="Project files">
        <label className="source-editor-search"><Search size={14} /><input aria-label="Search file names" placeholder="Find a file…" value={filter} onChange={event => setFilter(event.target.value)} /></label>
        <div className="source-editor-file-list">{source.files.filter(item => item.path.toLowerCase().includes(filter.toLowerCase())).map(item => <button key={item.path} type="button" aria-pressed={item.path === file.path} title={item.path} onClick={() => {setSelected(item.path); setDeleting(false); setMessage("");}}>{managedSourcePath(item.path) ? <LockKeyhole size={13} /> : <FileCode2 size={13} />}<span>{item.path}</span></button>)}{!source.files.some(item => item.path.toLowerCase().includes(filter.toLowerCase())) && <p>No matching files.</p>}</div>
        {!readOnly && <button type="button" className="source-editor-add" aria-expanded={adding} onClick={() => setAdding(!adding)}><Plus size={14} /> Add file</button>}
      </aside>
      <div className="source-editor-main">
        <div className="source-editor-file-heading"><code>{file.path}</code><span>{managedSourcePath(file.path) ? "Managed file" : readOnly ? "Read only" : "Editable"}</span>{!readOnly && removableSourcePath(source, file.path) && <button type="button" aria-label={`Remove ${file.path}`} onClick={() => setDeleting(true)}><Trash2 size={14} /></button>}</div>
        {deleting && <div className="source-editor-confirm" role="alert"><span>Remove {file.path}? Previous saved versions remain in History.</span><button type="button" onClick={() => mutate({type: "remove", path: file.path})}>Remove file</button><button type="button" onClick={() => setDeleting(false)}>Cancel</button></div>}
        <div className="source-editor-code" ref={host} />
        {syntaxSupported && <section className="source-editor-diagnostics" aria-label="Syntax diagnostics">
          <p>{!currentSyntax ? "Checking syntax…" : currentSyntax.issues.length ? `${currentSyntax.issues.length} syntax ${currentSyntax.issues.length === 1 ? "issue" : "issues"}${currentSyntax.complete ? "" : " · Partial scan"}` : currentSyntax.complete ? "No parser errors found" : "Partial syntax scan"}<span>Build and type checks have not run.</span></p>
          {currentSyntax?.issues.map((issue, index) => <button key={`${issue.from}:${index}`} type="button" onClick={() => {const view = editor.current; if (!view || view.state.doc.toString() !== currentSyntax.document) return; view.dispatch({selection: {anchor: issue.from, head: issue.to}, scrollIntoView: true}); view.focus();}}>Line {issue.line}:{issue.column} · {issue.message}</button>)}
        </section>}
      </div>
    </div>
    {adding && !readOnly && <form className="source-editor-new" onSubmit={event => {event.preventDefault(); mutate({type: "add", path: newPath.trim()});}}><label>New file path<input autoFocus aria-label="New file path" placeholder="src/components/Header.tsx" value={newPath} maxLength={240} onChange={event => setNewPath(event.target.value)} /></label><button type="submit" className="button secondary small">Add file</button><button type="button" className="button secondary small" onClick={() => setAdding(false)}>Cancel</button></form>}
    {message && <p className="source-editor-error" role="alert">{message}</p>}
    <footer className="source-editor-footer"><span>{source.files.length} files · {source.assets.length} artwork assets</span><span>Find in file: Ctrl / ⌘ F · Undo: Ctrl / ⌘ Z</span></footer>
  </section>;
}
