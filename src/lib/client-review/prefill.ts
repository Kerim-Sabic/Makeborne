/** Hands client feedback from the CRM to a project's builder composer.
 * Session-scoped and single-use; the text is only ever placed for review. */
const key = (artifactId: string) => `makeborne.review-prefill.v1:${artifactId}`;

export function storeReviewPrefill(artifactId: string, text: string) {
  try { sessionStorage.setItem(key(artifactId), text.slice(0, 8000)); return true; } catch { return false; }
}

export function takeReviewPrefill(artifactId: string) {
  try {
    const text = sessionStorage.getItem(key(artifactId));
    sessionStorage.removeItem(key(artifactId));
    return text && text.length <= 8000 ? text : null;
  } catch { return null; }
}
