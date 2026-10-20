"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, Plus, Search, Trash2, XCircle } from "lucide-react";
import { BUSINESS_TYPES, SiteSeoSchema, pageMeta, seoChecklist, type SeoCheck, type SiteSeo } from "@/lib/hosting/seo";
import type { WebsiteProjectSource } from "@/lib/projects/website-source";
import { captureProjectSnapshot } from "@/lib/builder/publish-snapshot";
import "@/app/website-seo.css";

type Business = NonNullable<SiteSeo["business"]>;
type Slot = NonNullable<Business["hours"]>[number];
const DAYS = [["Mo", "Mon"], ["Tu", "Tue"], ["We", "Wed"], ["Th", "Thu"], ["Fr", "Fri"], ["Sa", "Sat"], ["Su", "Sun"]] as const;
const TYPE_LABELS: Partial<Record<Business["type"], string>> = { LocalBusiness: "Local business", CafeOrCoffeeShop: "Café or coffee shop", BarOrPub: "Bar or pub", ClothingStore: "Clothing store", BeautySalon: "Beauty salon", HairSalon: "Hair salon", HealthAndBeautyBusiness: "Health and beauty", MedicalClinic: "Medical clinic", LegalService: "Legal services", AccountingService: "Accounting", RealEstateAgent: "Estate agent", HomeAndConstructionBusiness: "Home and construction", AutoRepair: "Car repair", ExerciseGym: "Gym", ProfessionalService: "Professional services", Organization: "Organisation (no premises)" };
const typeLabel = (type: Business["type"]) => TYPE_LABELS[type] ?? type.replace(/([a-z])([A-Z])/g, "$1 $2");

/** Drops empty strings and empty lists so optional fields stay absent. */
function compact(seo: SiteSeo): SiteSeo {
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) { const items = value.map(clean).filter(item => item !== undefined); return items.length ? items : undefined; }
    if (value && typeof value === "object") { const entries = Object.entries(value).map(([key, item]) => [key, clean(item)] as const).filter(([, item]) => item !== undefined); return entries.length ? Object.fromEntries(entries) : undefined; }
    return typeof value === "string" && !value.trim() ? undefined : value;
  };
  return (clean(seo) ?? {}) as SiteSeo;
}

export default function WebsiteSeo({ source, siteTitle, seo, disabled, scope, onChange }: {
  source: WebsiteProjectSource; siteTitle: string; seo: SiteSeo | undefined; disabled: boolean;
  scope: { accountId: string; workspaceId: string; artifactId: string }; onChange: (next: SiteSeo | undefined) => void;
}) {
  const [draft, setDraft] = useState<SiteSeo>(seo ?? {});
  const [problem, setProblem] = useState("");
  const [checks, setChecks] = useState<SeoCheck[] | null>(null);
  const [homeHtml, setHomeHtml] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const images = useMemo(() => source.assets.map(asset => `/${asset.path.replace(/^public\//, "")}`), [source.assets]);
  const business = draft.business;

  function update(next: SiteSeo) {
    setDraft(next);
    const cleaned = compact(next);
    const parsed = SiteSeoSchema.safeParse(cleaned);
    if (!parsed.success) { setProblem(parsed.error.issues[0].message); return; }
    setProblem("");
    onChange(Object.keys(parsed.data).length ? parsed.data : undefined);
  }
  const setPage = (path: string, field: "title" | "description", value: string) => {
    const pages = [...(draft.pages ?? [])], index = pages.findIndex(page => page.path === path);
    const entry = { ...(index >= 0 ? pages[index] : { path }), [field]: value };
    if (index >= 0) pages[index] = entry; else pages.push(entry);
    update({ ...draft, pages });
  };
  const setBusiness = (patch: Partial<Business>) => update({ ...draft, business: { type: "LocalBusiness", name: draft.siteName || siteTitle, ...business, ...patch } as Business });
  const setSlot = (index: number, patch: Partial<Slot>) => setBusiness({ hours: (business?.hours ?? []).map((slot, at) => at === index ? { ...slot, ...patch } : slot) });

  async function runChecks() {
    setChecking(true);
    try {
      const html = await captureProjectSnapshot(source, scope);
      setHomeHtml(html);
      const results = seoChecklist({ siteTitle, pages: [{ path: "/", routeTitle: source.routes.find(route => route.path === "/")?.title, html }], seo: compact(draft), images });
      // Only the home page is rendered here. Other pages are compared by title only; their text, images and links are not checked.
      const titles = source.routes.map(route => pageMeta({ path: route.path, routeTitle: route.title, siteTitle, html: "", seo: compact(draft) }).title);
      if (new Set(titles).size < titles.length) results.push({ id: "duplicate-titles", level: "warn", title: "Some pages share the same title", detail: "Give each page its own title below." });
      const others = source.routes.filter(route => route.path !== "/").length;
      if (others) results.push({ id: "other-pages", level: "info", title: `${others === 1 ? "1 other page was" : `${others} other pages were`} checked for titles only`, detail: "Their text, images and links aren't checked here. Open them in the preview to look them over before you share the site." });
      setChecks(results);
    } catch (cause) { setChecks([{ id: "error", level: "fail", title: "The site couldn't be checked", detail: cause instanceof Error ? cause.message : "Try again in a moment." }]); }
    finally { setChecking(false); }
  }

  const home = pageMeta({ path: "/", siteTitle, html: homeHtml ?? "", seo: compact(draft) });
  return <section className="website-publish ws" aria-label="Search and sharing">
    <h3><Search size={16} />Search &amp; sharing</h3>
    <div className="ws-preview" aria-label="How your home page may look on Google">
      <span className="ws-preview-url">Your website address</span>
      <strong className="ws-preview-title">{home.title}</strong>
      <span className="ws-preview-text">{home.description}</span>
    </div>
    {problem && <p className="ws-error" role="alert">{problem}</p>}
    <fieldset className="ws-group" disabled={disabled}>
      <legend>Pages</legend>
      <label className="ws-field"><span>Site name</span><input id="ws-site-name" value={draft.siteName ?? ""} placeholder={siteTitle} maxLength={80} onChange={event => update({ ...draft, siteName: event.target.value })} /></label>
      {source.routes.map(route => {
        const custom = draft.pages?.find(page => page.path === route.path);
        const auto = pageMeta({ path: route.path, routeTitle: route.title, siteTitle, html: route.path === "/" ? homeHtml ?? "" : "", seo: compact({ ...draft, pages: [] }) });
        return <div key={route.path} className="ws-page">
          <code>{route.path}</code>
          <label className="ws-field"><span>Title</span><input id={`ws-title-${route.path}`} value={custom?.title ?? ""} placeholder={auto.title} maxLength={70} onChange={event => setPage(route.path, "title", event.target.value)} /></label>
          <label className="ws-field"><span>Description <small>{(custom?.description ?? "").length}/160</small></span><textarea id={`ws-description-${route.path}`} rows={2} value={custom?.description ?? ""} placeholder={route.path === "/" && !homeHtml ? "Written from the page's opening text when you publish. Run “Check my site” to see it." : auto.description} maxLength={200} onChange={event => setPage(route.path, "description", event.target.value)} /></label>
        </div>;
      })}
    </fieldset>
    <fieldset className="ws-group" disabled={disabled}>
      <legend>Share image</legend>
      <p className="ws-hint">Shown when your link is shared on WhatsApp, Facebook or LinkedIn.</p>
      {images.length ? <select id="ws-share-image" value={draft.shareImage ?? ""} onChange={event => update({ ...draft, shareImage: event.target.value || undefined })}>
        <option value="">No share image</option>{images.map(image => <option key={image} value={image}>{image.split("/").pop()}</option>)}
      </select> : <p className="ws-hint">This website has no images yet.</p>}
    </fieldset>
    <fieldset className="ws-group" disabled={disabled}>
      <legend>Business details</legend>
      <p className="ws-hint">Helps you appear in Google&apos;s local results and on Maps.</p>
      {!business ? <button type="button" className="button secondary small" onClick={() => setBusiness({})}><Plus size={14} />Add business details</button> : <>
        <div className="ws-grid">
          <label className="ws-field"><span>Type</span><select id="ws-type" value={business.type} onChange={event => setBusiness({ type: event.target.value as Business["type"] })}>{BUSINESS_TYPES.map(type => <option key={type} value={type}>{typeLabel(type)}</option>)}</select></label>
          <label className="ws-field"><span>Business name</span><input id="ws-name" value={business.name} maxLength={120} onChange={event => setBusiness({ name: event.target.value })} /></label>
          <label className="ws-field ws-wide"><span>Street address</span><input id="ws-street" value={business.street ?? ""} maxLength={160} autoComplete="street-address" onChange={event => setBusiness({ street: event.target.value })} /></label>
          <label className="ws-field"><span>Town or city</span><input id="ws-city" value={business.city ?? ""} maxLength={80} onChange={event => setBusiness({ city: event.target.value })} /></label>
          <label className="ws-field"><span>Postcode</span><input id="ws-postcode" value={business.postcode ?? ""} maxLength={20} onChange={event => setBusiness({ postcode: event.target.value })} /></label>
          <label className="ws-field"><span>Country code</span><input id="ws-country" value={business.country ?? ""} placeholder="GB" maxLength={2} onChange={event => setBusiness({ country: event.target.value.toUpperCase() })} /></label>
          <label className="ws-field"><span>Phone</span><input id="ws-phone" type="tel" value={business.phone ?? ""} placeholder="+44 131 496 0000" maxLength={40} onChange={event => setBusiness({ phone: event.target.value })} /></label>
          <label className="ws-field"><span>Email</span><input id="ws-email" type="email" value={business.email ?? ""} maxLength={254} onChange={event => setBusiness({ email: event.target.value })} /></label>
          <label className="ws-field"><span>Price range</span><select id="ws-price" value={business.priceRange ?? ""} onChange={event => setBusiness({ priceRange: event.target.value || undefined })}><option value="">Not shown</option>{["£", "££", "£££", "££££", "$", "$$", "$$$", "€", "€€", "€€€"].map(price => <option key={price}>{price}</option>)}</select></label>
        </div>
        <div className="ws-hours">
          <span className="ws-label">Opening hours</span>
          {(business.hours ?? []).map((slot, index) => <div key={index} className="ws-slot" role="group" aria-label={`Opening hours ${index + 1}`}>
            <div className="ws-days">{DAYS.map(([day, label]) => <label key={day}><input type="checkbox" checked={slot.days.includes(day)} onChange={event => setSlot(index, { days: event.target.checked ? [...slot.days, day].sort((a, b) => DAYS.findIndex(entry => entry[0] === a) - DAYS.findIndex(entry => entry[0] === b)) : slot.days.filter(item => item !== day) })} />{label}</label>)}</div>
            <input type="time" aria-label="Opens" value={slot.opens} onChange={event => setSlot(index, { opens: event.target.value })} />
            <span>to</span>
            <input type="time" aria-label="Closes" value={slot.closes} onChange={event => setSlot(index, { closes: event.target.value })} />
            <button type="button" className="ws-icon" aria-label="Remove these hours" onClick={() => setBusiness({ hours: (business.hours ?? []).filter((_, at) => at !== index) })}><Trash2 size={14} /></button>
          </div>)}
          {(business.hours?.length ?? 0) < 14 && <button type="button" className="ws-link" onClick={() => setBusiness({ hours: [...(business.hours ?? []), { days: ["Mo", "Tu", "We", "Th", "Fr"], opens: "09:00", closes: "17:00" }] })}><Plus size={13} />Add opening hours</button>}
        </div>
        <label className="ws-field ws-wide"><span>Social profiles <small>one https link per line</small></span><textarea id="ws-same-as" rows={2} value={(business.sameAs ?? []).join("\n")} onChange={event => setBusiness({ sameAs: event.target.value.split(/\n/).map(line => line.trim()) })} /></label>
        <button type="button" className="ws-link ws-remove" onClick={() => update({ ...draft, business: undefined })}><Trash2 size={13} />Remove business details</button>
      </>}
    </fieldset>
    <div className="ws-check">
      <button type="button" className="button secondary small" disabled={checking} onClick={() => void runChecks()}>{checking ? <Loader2 size={14} className="ws-spin" /> : <Search size={14} />}Check my site</button>
      {checks && <ul className="ws-results" aria-label="Search checklist">{checks.map(check => <li key={check.id} data-level={check.level}>
        {check.level === "pass" ? <CheckCircle2 size={15} aria-hidden="true" /> : check.level === "fail" ? <XCircle size={15} aria-hidden="true" /> : check.level === "info" ? <Info size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}
        <div><strong>{check.title}</strong><span>{check.detail}</span></div>
      </li>)}</ul>}
    </div>
  </section>;
}
