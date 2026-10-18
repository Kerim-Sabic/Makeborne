// W11 valid HTML: html-validate with scripts/eval/htmlvalidate.json.
// The config carries a "// reasons" key that documents every disabled rule;
// html-validate's schema rejects unknown keys, so comment keys are stripped
// here before the config is used.
import path from 'node:path';
import { HtmlValidate } from 'html-validate';
import { EVAL_DIR, readJson, writeJson } from '../paths.mjs';

export const CONFIG_FILE = path.join(EVAL_DIR, 'htmlvalidate.json');

let validator;

/** The effective config (comment keys removed), as handed to html-validate. */
export function loadConfig(file = CONFIG_FILE) {
  const raw = readJson(file);
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith('//')));
}

function instance() {
  validator ??= new HtmlValidate({ root: true, ...loadConfig() });
  return validator;
}

/**
 * Validate one HTML document.
 * @param {string} html
 * @param {{outFile?: string}} [options] also writes the result as JSON when given
 * @returns {Promise<{errors: number, warnings: number, byRule: Record<string, number>,
 *   messages: Array<{ruleId: string, severity: 'error'|'warning', message: string, line: number, column: number, selector: string|null}>}>}
 */
export async function validateHtml(html, { outFile } = {}) {
  const report = await instance().validateString(String(html ?? ''), 'snapshot.html');
  const messages = report.results.flatMap(result => result.messages).map(message => ({
    ruleId: message.ruleId,
    severity: message.severity === 2 ? 'error' : 'warning',
    message: message.message,
    line: message.line,
    column: message.column,
    selector: message.selector ?? null,
  }));
  const byRule = {};
  for (const message of messages) byRule[message.ruleId] = (byRule[message.ruleId] ?? 0) + 1;
  const result = {
    errors: messages.filter(message => message.severity === 'error').length,
    warnings: messages.filter(message => message.severity === 'warning').length,
    byRule,
    messages,
  };
  if (outFile) writeJson(outFile, result);
  return result;
}
