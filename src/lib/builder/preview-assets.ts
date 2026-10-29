/**
 * Project images for the in-browser preview: loaded before the first compile of a saved project, so an import such as
 * `./artwork/coastal-dog.webp` is never compiled against an image list that is still loading. Each failure is classified,
 * so the preview can say what actually happened: a missing or denied image is reported at once, a passing failure
 * (network, 408/429, 5xx) is retried a bounded number of times, and nothing is invented in place of an image.
 */

export type PreviewAsset = { id: string; path: string };
export type AssetFailure = "missing" | "denied" | "unavailable" | "invalid";
export type AssetProblem = { path: string; reason: AssetFailure };
export type AssetLoad = { images: Record<string, string>; problems: AssetProblem[] };

/** Waits before the 2nd and 3rd attempt of a passing failure; three attempts in all. */
export const ASSET_RETRY_DELAYS_MS = [400, 1200] as const;

export function classifyAssetFailure(error: unknown): AssetFailure {
  const status = typeof error === "object" && error !== null && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : null;
  if (typeof error === "object" && error !== null && (error as { invalid?: unknown }).invalid === true) return "invalid";
  if (status === 404 || status === 410) return "missing";
  if (status === 401 || status === 403) return "denied";
  // No status: the request never got an answer (offline, reset, timeout). 408, 429 and 5xx are passing by nature.
  return "unavailable";
}

export const retryable = (reason: AssetFailure) => reason === "unavailable";

/** The preview's import key for a saved asset path: `public/` is served from the site root. */
export const previewAssetKey = (path: string) => `/${path.replace(/^public\//, "")}`;

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason);
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

/**
 * Loads every asset (cache first), retrying only passing failures. Rejects only when `signal` aborts, so a superseded
 * load never reports a result; otherwise every asset ends up either loaded or listed in `problems` with its reason.
 */
export async function loadPreviewAssets(assets: readonly PreviewAsset[], fetchOne: (asset: PreviewAsset, signal: AbortSignal) => Promise<string>,
  options: { signal: AbortSignal; cache?: Map<string, string>; delays?: readonly number[] }): Promise<AssetLoad> {
  const { signal, cache, delays = ASSET_RETRY_DELAYS_MS } = options;
  const images: Record<string, string> = {}, problems: AssetProblem[] = [];
  for (const asset of assets) {
    let url = cache?.get(asset.id);
    for (let attempt = 0; !url; attempt++) {
      if (signal.aborted) throw signal.reason;
      try {
        url = await fetchOne(asset, signal);
        cache?.set(asset.id, url);
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        const reason = classifyAssetFailure(error);
        if (!retryable(reason) || attempt >= delays.length) { problems.push({ path: asset.path, reason }); break; }
        await wait(delays[attempt], signal);
      }
    }
    if (url) images[previewAssetKey(asset.path)] = url;
  }
  return { images, problems };
}

/** Whether a failed compile is explained by images that could not be loaded (their file name appears in the error). */
export function compileBlockedByAssets(error: string, problems: readonly AssetProblem[]) {
  return problems.some(problem => { const name = problem.path.split("/").pop() ?? ""; return Boolean(name) && error.includes(name); });
}

const REASON_TEXT: Record<AssetFailure, string> = {
  missing: "isn't in this project's saved images",
  denied: "isn't available to this account",
  unavailable: "couldn't be loaded (connection problem)",
  invalid: "didn't arrive as a valid image",
};
/** One plain line per image, e.g. `artwork/coastal-dog.webp couldn't be loaded (connection problem)`. */
export const describeAssetProblem = (problem: AssetProblem) => `${problem.path.replace(/^(?:public|src)\//, "")} ${REASON_TEXT[problem.reason]}`;
