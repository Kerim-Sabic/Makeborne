import { analyticsPrivacyAllowed } from "./vercel-analytics";

/** The Whop Pixel exactly as Whop issued it for biz_CV9cZg1zFX3h7f (byte-checked in check-ad-measurement.cjs). */
export const WHOP_PIXEL_SNIPPET = `<script>!function(w,d,s,u,n,a,b){if(w[n])return;a=w[n]={q:[],t:+new Date,s:[],o:u,track:function(){a.q.push([+new Date].concat([].slice.call(arguments)))},setScope:function(){a.s=[].slice.call(arguments).filter(function(x){return typeof x==="string"});a.q.push([+new Date,"setScope"].concat(a.s))},scope:function(){var c=[].slice.call(arguments);return{track:function(){a.q.push([+new Date].concat([].slice.call(arguments)).concat([{__scope:c}]))}}}};b=d.createElement(s);b.async=1;b.src=u+"/s.js";d.getElementsByTagName(s)[0].parentNode.insertBefore(b,d.getElementsByTagName(s)[0])}(window,document,"script","https://t.whop.tw","whop");whop.setScope("biz_CV9cZg1zFX3h7f");whop.track("page");</script>`;
export const WHOP_PIXEL_CODE = WHOP_PIXEL_SNIPPET.slice("<script>".length, -"</script>".length);

/** Bump when the banner or the privacy text about ad measurement changes: everyone is asked again. */
export const AD_NOTICE_VERSION = "2026-11-17";
export const AD_CHOICE_KEY = "makeborne.ad-measurement.v1";
export const AD_CHOICE_EVENT = "makeborne:ad-measurement";
/** A choice either way is kept for six months, then the banner asks again. */
const CHOICE_DAYS = 182;

export const AD_HOSTS = ["makeborne.com", "www.makeborne.com"];
// Public funnel pages only: never the studio, chat, portal, review links, admin or sign-in callbacks.
const PAGES = new Set(["/", "/billing", "/login", "/signup", "/templates", "/done-for-you", "/terms", "/privacy", "/dpa", "/imprint", "/refunds", "/withdraw"]);
// The pixel reads location.href, including email, phone and name parameters: only campaign tags may be present.
const SAFE_PARAMS = new Set(["fbclid", "gclid", "ttclid", "msclkid", "ref", "whop_verify"]);

/** Whether the pixel may see this exact URL: a public page on our host, campaign tags only, a plain anchor at most. */
export function adPageAllowed(url: URL, hosts: readonly string[] = AD_HOSTS): boolean {
  if (!hosts.includes(url.hostname) || url.username || url.password) return false;
  if (url.protocol !== "https:" && url.hostname !== "localhost") return false;
  if (!PAGES.has(url.pathname) && !/^\/help(?:\/[a-z0-9-]+)*\/?$/.test(url.pathname)) return false;
  if (url.hash && !/^#[A-Za-z0-9_-]{1,64}$/.test(url.hash)) return false;
  return [...url.searchParams.keys()].every(key => SAFE_PARAMS.has(key) || /^utm_[a-z]{1,20}$/.test(key));
}

/** Do Not Track and Global Privacy Control mean no banner and no pixel. */
export const adSignalsAllowed = analyticsPrivacyAllowed;

export type AdChoice = "granted" | "denied";
export function readAdChoice(raw: string | null | undefined, now = Date.now()): AdChoice | null {
  try {
    const record = JSON.parse(raw ?? "null") as { choice?: unknown; at?: unknown; notice?: unknown } | null;
    if (!record || (record.choice !== "granted" && record.choice !== "denied") || record.notice !== AD_NOTICE_VERSION || typeof record.at !== "string") return null;
    const at = Date.parse(record.at);
    return Number.isFinite(at) && at <= now && now - at < CHOICE_DAYS * 86_400_000 ? record.choice : null;
  } catch { return null; }
}
export const adChoiceRecord = (choice: AdChoice, now = Date.now()) => JSON.stringify({ choice, at: new Date(now).toISOString(), notice: AD_NOTICE_VERSION });

type HistoryMethod = (data: unknown, unused: string, url?: string | URL | null) => void;
const FENCED = "__makeborneAdFence";

/**
 * Installed before the pixel so the pixel's own history hook wraps it: a client-side move to a URL the pixel
 * may not see becomes a full page load instead, so the pixel never reports it and is gone on the next page.
 */
export function fenceHistory(win: Pick<Window, "history" | "location">, allowed: (url: URL) => boolean = url => adPageAllowed(url)) {
  const history = win.history as History & { [FENCED]?: true };
  if (history[FENCED]) return;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = (history[method] as HistoryMethod).bind(history);
    (history as unknown as Record<string, HistoryMethod>)[method] = (data, unused, url) => {
      if (url != null) {
        const next = new URL(String(url), win.location.href);
        if (next.href !== win.location.href && !allowed(next)) { win.location.assign(next.href); return; }
      }
      original(data, unused, url);
    };
  }
  history[FENCED] = true;
}

/** Runs the snippet once, in <head>. */
export function startWhopPixel(doc: Document) {
  if (doc.getElementById("whop-pixel")) return;
  const script = doc.createElement("script");
  script.id = "whop-pixel";
  script.text = WHOP_PIXEL_CODE;
  doc.head.appendChild(script);
}

/** The pixel's first-party cookies and storage (from t.whop.tw/s.js), removed when someone withdraws. */
export const WHOP_COOKIES = ["_wuid", "_wuid_link", "_wfp", "_wsc", "_wsc_probed", "_wsc_probed_at", "_wpd"];
export function clearWhopStorage(win: Pick<Window, "document" | "localStorage" | "sessionStorage" | "location">) {
  const domain = win.location.hostname.replace(/^www\./, "");
  for (const name of WHOP_COOKIES) for (const scope of ["", `; domain=${domain}`, `; domain=.${domain}`]) win.document.cookie = `${name}=; path=/; max-age=0${scope}`;
  for (const store of [win.localStorage, win.sessionStorage]) {
    try {
      const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((key): key is string => !!key && (/^_w/.test(key) || /^whop_/.test(key)));
      for (const key of keys) store.removeItem(key);
    } catch { /* storage blocked: nothing of the pixel's can be there either */ }
  }
}
