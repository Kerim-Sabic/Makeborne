/** Prepared pages are shown without network access or form submission: a strict
 * CSP is added to the document head. Client-safe and pure. */
export const PREPARED_PREVIEW_POLICY = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'";
export function previewDocument(html: string) {
  return html.replace(/<head>/i, `<head><meta http-equiv="Content-Security-Policy" content="${PREPARED_PREVIEW_POLICY}">`);
}
