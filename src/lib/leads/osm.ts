/**
 * Local-business search on OpenStreetMap: a city name through Nominatim, then
 * the matching businesses through Overpass. Listings are © OpenStreetMap
 * contributors (ODbL); the UI shows that attribution with every result.
 * Both public services ask for a clear User-Agent and modest use: one
 * geocode per search (cached), one Overpass query per search.
 */

export const OSM_ATTRIBUTION = "Business listings © OpenStreetMap contributors (ODbL)";
const USER_AGENT = "Makeborne/1.0 (+https://makeborne.com; admin@makeborne.com)";
const NOMINATIM = () => process.env.MAKEBORNE_NOMINATIM_URL || "https://nominatim.openstreetmap.org";
const OVERPASS = () => process.env.MAKEBORNE_OVERPASS_URL || "https://overpass-api.de/api/interpreter";

type Category = { label: string; words: string[]; tags: string[] };
/** Common client niches → OSM tags. Anything else falls back to a name search across business tags. */
export const CATEGORIES: Category[] = [
  { label: "Dentists", words: ["dentist", "dental", "orthodont"], tags: ['"amenity"="dentist"', '"healthcare"="dentist"'] },
  { label: "Doctors & clinics", words: ["doctor", "clinic", "medical", "physician"], tags: ['"amenity"="doctors"', '"amenity"="clinic"', '"healthcare"="doctor"', '"healthcare"="clinic"'] },
  { label: "Physiotherapists", words: ["physio", "physiotherap", "chiropract"], tags: ['"healthcare"="physiotherapist"', '"healthcare"="chiropractor"'] },
  { label: "Veterinarians", words: ["vet", "veterinar", "animal clinic"], tags: ['"amenity"="veterinary"'] },
  { label: "Pharmacies", words: ["pharmac", "chemist", "apothek"], tags: ['"amenity"="pharmacy"'] },
  { label: "Restaurants", words: ["restaurant", "dining", "bistro", "eatery"], tags: ['"amenity"="restaurant"'] },
  { label: "Cafés", words: ["cafe", "café", "coffee"], tags: ['"amenity"="cafe"'] },
  { label: "Bars & pubs", words: ["bar", "pub", "cocktail"], tags: ['"amenity"="bar"', '"amenity"="pub"'] },
  { label: "Bakeries", words: ["bakery", "bakeries", "pastry", "patisserie"], tags: ['"shop"="bakery"', '"shop"="pastry"'] },
  { label: "Hotels & stays", words: ["hotel", "hostel", "guest house", "guesthouse", "apartment", "b&b", "accommodation"], tags: ['"tourism"="hotel"', '"tourism"="guest_house"', '"tourism"="hostel"', '"tourism"="apartment"'] },
  { label: "Gyms & fitness", words: ["gym", "fitness", "crossfit", "personal trainer"], tags: ['"leisure"="fitness_centre"', '"sport"="fitness"'] },
  { label: "Yoga & pilates studios", words: ["yoga", "pilates"], tags: ['"sport"="yoga"', '"sport"="pilates"'] },
  { label: "Hair salons & barbers", words: ["hair", "barber", "salon", "hairdresser"], tags: ['"shop"="hairdresser"'] },
  { label: "Beauty & nails", words: ["beauty", "nail", "cosmetic", "spa", "lash", "brow"], tags: ['"shop"="beauty"', '"shop"="cosmetics"', '"leisure"="spa"', '"amenity"="spa"'] },
  { label: "Tattoo studios", words: ["tattoo", "piercing"], tags: ['"shop"="tattoo"'] },
  { label: "Lawyers", words: ["lawyer", "law firm", "attorney", "solicitor", "legal"], tags: ['"office"="lawyer"'] },
  { label: "Accountants", words: ["accountant", "accounting", "bookkeep", "tax advis"], tags: ['"office"="accountant"', '"office"="tax_advisor"'] },
  { label: "Real estate agents", words: ["real estate", "estate agent", "realtor", "property"], tags: ['"office"="estate_agent"'] },
  { label: "Insurance agents", words: ["insurance"], tags: ['"office"="insurance"'] },
  { label: "Architects", words: ["architect"], tags: ['"office"="architect"'] },
  { label: "Marketing & design agencies", words: ["agency", "marketing", "advertising", "design studio"], tags: ['"office"="advertising_agency"', '"office"="marketing"', '"craft"="graphic_design"'] },
  { label: "IT & software companies", words: ["software", "it company", "web developer", "it services"], tags: ['"office"="it"', '"office"="software"'] },
  { label: "Photographers", words: ["photograph", "photo studio"], tags: ['"craft"="photographer"', '"shop"="photo"', '"office"="photographer"'] },
  { label: "Car repair & dealers", words: ["car repair", "mechanic", "garage", "car dealer", "auto"], tags: ['"shop"="car_repair"', '"shop"="car"', '"shop"="tyres"'] },
  { label: "Bike shops", words: ["bike", "bicycle", "cycling"], tags: ['"shop"="bicycle"'] },
  { label: "Florists", words: ["florist", "flower"], tags: ['"shop"="florist"'] },
  { label: "Clothing & boutiques", words: ["clothing", "fashion", "boutique", "apparel"], tags: ['"shop"="clothes"', '"shop"="boutique"', '"shop"="fashion"'] },
  { label: "Jewellers", words: ["jewel", "jewelry", "jewellery"], tags: ['"shop"="jewelry"'] },
  { label: "Furniture & interiors", words: ["furniture", "interior"], tags: ['"shop"="furniture"', '"shop"="interior_decoration"', '"craft"="interior_decorator"'] },
  { label: "Pet shops & groomers", words: ["pet", "dog groom", "grooming"], tags: ['"shop"="pet"', '"shop"="pet_grooming"'] },
  { label: "Schools & tutoring", words: ["school", "tutor", "language school", "academy", "driving school"], tags: ['"amenity"="language_school"', '"amenity"="driving_school"', '"amenity"="music_school"', '"office"="educational_institution"'] },
  { label: "Wedding & event venues", words: ["wedding", "event venue", "banquet"], tags: ['"amenity"="events_venue"', '"shop"="wedding"'] },
  { label: "Builders & trades", words: ["builder", "construction", "plumber", "electrician", "roofer", "carpenter", "painter"], tags: ['"craft"="builder"', '"craft"="plumber"', '"craft"="electrician"', '"craft"="roofer"', '"craft"="carpenter"', '"craft"="painter"', '"office"="construction_company"'] },
  { label: "Cleaning services", words: ["cleaning", "cleaner"], tags: ['"shop"="dry_cleaning"', '"office"="cleaning"', '"craft"="cleaning"'] },
  { label: "Wineries & breweries", words: ["winery", "wine", "brewery", "distillery"], tags: ['"craft"="winery"', '"craft"="brewery"', '"craft"="distillery"', '"shop"="wine"'] },
];

/** The niche as OSM tag filters, or a safe name search when no category matches. */
export function resolveCategory(raw: string): { label: string; filters: string[]; byName: boolean } {
  const text = raw.toLowerCase().trim();
  // Words match at a word start, and the longest match wins ("barber" is a hair salon, not a bar).
  let match: Category | undefined, best = 0;
  for (const category of CATEGORIES) for (const word of category.words) {
    if (word.length > best && new RegExp(`(^|[^\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(text)) { match = category; best = word.length; }
  }
  if (match) return { label: match.label, filters: match.tags.map(tag => `[${tag}]`), byName: false };
  // Free text: letters, digits and spaces only, so it can't escape the Overpass regex.
  const word = text.replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  if (word.length < 3) throw new Error("Describe the kind of business in a few words, like “dentists” or “yoga studios”.");
  return { label: raw.trim().slice(0, 60), filters: ["shop", "office", "amenity", "craft", "leisure", "healthcare", "tourism"].map(key => `["name"~"${word}",i]["${key}"]`), byName: true };
}

export type Place = { name: string; lat: number; lon: number; area: number | null; rank: number };

/** Overpass for one area (or a radius around a town point), newest-first not guaranteed. */
export function buildOverpassQuery(filters: string[], place: Place, limit: number) {
  const scope = place.area ? "(area.a)" : `(around:9000,${place.lat.toFixed(5)},${place.lon.toFixed(5)})`;
  return [
    "[out:json][timeout:25];",
    place.area ? `area(id:${place.area})->.a;` : "",
    "(",
    ...filters.map(filter => `  nwr${filter}${scope};`),
    ");",
    `out center tags ${Math.max(20, Math.min(400, limit))};`,
  ].filter(Boolean).join("\n");
}

export type OsmBusiness = {
  osmId: string; name: string; category: string; website: string; email: string; phone: string;
  instagram: string; facebook: string; address: string; city: string;
};

const cleanUrl = (raw: string | undefined) => {
  const value = (raw ?? "").split(";")[0].trim();
  if (!value) return "";
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try { const url = new URL(withScheme); return ["http:", "https:"].includes(url.protocol) ? url.toString() : ""; } catch { return ""; }
};
const socialUrl = (raw: string | undefined, host: string) => {
  const value = (raw ?? "").split(";")[0].trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return cleanUrl(value);
  const handle = value.replace(/^@/, "").replace(/[^\w.]/g, "");
  return handle ? `https://www.${host}/${handle}/` : "";
};

/** Overpass JSON → named businesses, de-duplicated by name + website. */
export function parseOverpass(json: unknown, categoryLabel: string): OsmBusiness[] {
  const elements = (json as { elements?: Array<{ type: string; id: number; tags?: Record<string, string> }> })?.elements ?? [];
  const seen = new Set<string>(), out: OsmBusiness[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const name = (tags.name ?? tags.brand ?? "").trim();
    if (!name) continue;
    const website = cleanUrl(tags.website ?? tags["contact:website"] ?? tags.url);
    const key = `${name.toLowerCase()}|${website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const email = (tags.email ?? tags["contact:email"] ?? "").split(";")[0].trim();
    out.push({
      osmId: `${element.type}/${element.id}`, name: name.slice(0, 120), category: categoryLabel, website,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.slice(0, 200) : "",
      phone: (tags.phone ?? tags["contact:phone"] ?? "").split(";")[0].trim().slice(0, 40),
      instagram: socialUrl(tags["contact:instagram"] ?? tags.instagram, "instagram.com"),
      facebook: socialUrl(tags["contact:facebook"] ?? tags.facebook, "facebook.com"),
      address: [[tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" "), tags["addr:postcode"]].filter(Boolean).join(", ").slice(0, 160),
      city: (tags["addr:city"] ?? "").slice(0, 80),
    });
  }
  // Reachable businesses first: a website (and so an email we can find) beats a bare listing.
  const reach = (item: OsmBusiness) => (item.website ? 4 : 0) + (item.email ? 3 : 0) + (item.instagram ? 1 : 0) + (item.phone ? 1 : 0);
  return out.sort((a, b) => reach(b) - reach(a));
}

const geocodeCache = new Map<string, { at: number; place: Place }>();
let lastGeocode = 0;

/** Nominatim: one request per new place name, at most one per second per server, cached for a day. */
export async function geocode(placeName: string, fetcher: typeof fetch = fetch): Promise<Place> {
  const key = placeName.trim().toLowerCase();
  const cached = geocodeCache.get(key);
  if (cached && Date.now() - cached.at < 86_400_000) return cached.place;
  const wait = lastGeocode + 1100 - Date.now();
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastGeocode = Date.now();
  const url = `${NOMINATIM()}/search?${new URLSearchParams({ q: placeName.trim(), format: "jsonv2", limit: "1", "accept-language": "en" })}`;
  const response = await fetcher(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("The map service is busy. Try again in a minute.");
  const [hit] = await response.json() as Array<{ display_name: string; lat: string; lon: string; osm_type: string; osm_id: number; place_rank: number; addresstype?: string; type?: string }>;
  if (!hit) throw new Error(`Couldn't find “${placeName.trim()}”. Try the city name with its country, like “Sarajevo, Bosnia”.`);
  // City-states (Berlin, Vienna, Hamburg) rank like regions but are cities.
  const cityLike = ["city", "town", "village", "municipality", "borough", "suburb", "city_district", "district", "county"].includes(hit.addresstype ?? hit.type ?? "");
  if (hit.place_rank < 12 && !cityLike) throw new Error("That area is too large to search at once. Choose a city, town or district.");
  const area = hit.osm_type === "relation" ? 3_600_000_000 + hit.osm_id : hit.osm_type === "way" ? 2_400_000_000 + hit.osm_id : null;
  const place = { name: hit.display_name.split(",").slice(0, 2).join(",").trim(), lat: Number(hit.lat), lon: Number(hit.lon), area, rank: hit.place_rank };
  geocodeCache.set(key, { at: Date.now(), place });
  return place;
}

/** Businesses of one niche in one place, reachable ones first. */
export async function searchBusinesses(input: { niche: string; place: string; limit: number }, fetcher: typeof fetch = fetch) {
  const category = resolveCategory(input.niche);
  const place = await geocode(input.place, fetcher);
  const query = buildOverpassQuery(category.filters, place, input.limit * 6);
  return { category, place, businesses: parseOverpass(await overpass(query, fetcher), category.label) };
}

/** Public Overpass servers share load: a busy or failing one hands over to the next mirror. */
export const overpassEndpoints = () => (process.env.MAKEBORNE_OVERPASS_URL ? [process.env.MAKEBORNE_OVERPASS_URL]
  : [OVERPASS(), "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]);
/** Same query within six hours: the cached answer (listings change slowly). */
const overpassCache = new Map<string, { at: number; json: unknown }>();
const CACHE_MS = 6 * 3_600_000, CACHE_SIZE = 200;
/** One query at a time per server (public instances allow two per IP); a long queue or a recent "busy" goes straight to the fallback. */
let queue: Promise<unknown> = Promise.resolve(), waiting = 0, busyUntil = 0;
const MAX_WAITING = 3, COOL_DOWN_MS = 60_000;
export class MapBusyError extends Error {}
/** For offline checks only. */
export function resetOverpassState() { overpassCache.clear(); queue = Promise.resolve(); waiting = 0; busyUntil = 0; }

export async function overpass(query: string, fetcher: typeof fetch = fetch, pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))) {
  const cached = overpassCache.get(query);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.json;
  if (Date.now() < busyUntil || waiting >= MAX_WAITING) throw new MapBusyError("The map service is busy right now. Try again in a minute; nothing was charged.");
  waiting++;
  const run = queue.then(() => askMirrors(query, fetcher, pause));
  queue = run.catch(() => undefined);
  try {
    const json = await run;
    overpassCache.set(query, { at: Date.now(), json });
    if (overpassCache.size > CACHE_SIZE) overpassCache.delete(overpassCache.keys().next().value!);
    return json;
  } catch (error) {
    if (error instanceof MapBusyError) busyUntil = Date.now() + COOL_DOWN_MS;
    throw error;
  } finally { waiting--; }
}

async function askMirrors(query: string, fetcher: typeof fetch, pause: (ms: number) => Promise<unknown>) {
  let busy = false;
  // The whole search gets ~50 s, so a slow mirror can't push the run past its time limit.
  const deadline = Date.now() + 50_000;
  for (const [index, endpoint] of overpassEndpoints().entries()) {
    if (index) await pause(800);
    const left = deadline - Date.now();
    if (left < 8_000) break;
    try {
      const response = await fetcher(endpoint, { method: "POST", headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ data: query }).toString(), signal: AbortSignal.timeout(Math.min(25_000, left)) });
      if (response.ok) return await response.json();
      await response.body?.cancel();
      busy ||= response.status === 429 || response.status === 504;
    } catch { /* timeout or network: try the next mirror */ }
  }
  if (busy) throw new MapBusyError("The map service is busy right now. Try again in a minute; nothing was charged.");
  throw new Error("The business search didn't answer. Try again; nothing was charged.");
}
