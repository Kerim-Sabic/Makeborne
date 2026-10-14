import {syntaxTree, syntaxTreeAvailable} from "@codemirror/language";
import type {EditorState} from "@codemirror/state";

export type SourceSyntaxIssue = {from: number; to: number; line: number; column: number; message: string};
export type SourceSyntaxReport = {complete: boolean; issues: SourceSyntaxIssue[]};
/** Reads the editor's existing parser tree. Never imports, executes or type-checks customer code. */
export function sourceSyntaxDiagnostics(state: EditorState): SourceSyntaxReport {
  const cursor = syntaxTree(state).cursor(), issues: SourceSyntaxIssue[] = [];
  const positions = new Set<string>();
  let visited = 0, bounded = false;
  do {
    if (++visited > 40_000 || issues.length >= 20) {bounded = true; break;}
    if (cursor.type.isError) {
      const from = Math.min(cursor.from, state.doc.length), line = state.doc.lineAt(from);
      const to = Math.min(state.doc.length, Math.max(cursor.to, from + 1)), key = `${from}:${to}`;
      if (!positions.has(key)) {positions.add(key); issues.push({from, to, line: line.number, column: from - line.from + 1, message: "Check the syntax near this position."});}
    }
  } while (cursor.next());
  return {complete: !bounded && syntaxTreeAvailable(state, state.doc.length), issues};
}
