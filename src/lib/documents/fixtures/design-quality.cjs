/* Synthetic, illustrative document fixtures for the design-quality checks. Copy sits at the
 * lengths the agent prompt recommends (and a little beyond), not at schema maxima. */
const palette = { background: "#F4F1EA", surface: "#E8E1D3", ink: "#17150F", muted: "#57524A", accent: "#A3452A", accent2: "#2E5C55", dark: "#1C2422" };
const notes = "Synthetic design-quality fixture.";
const slide = (id, layout, extra) => ({ id, layout, tone: "light", title: "Pilots save more water every single month", notes, ...extra });

function deckSlides() {
  return [
    slide("cover", "cover", { tone: "dark", eyebrow: "Seed round · 2026", title: "Stop paying for water you never see", subtitle: "Sensors and a weekly fix list that find hidden leaks in apartment buildings before they become insurance claims." }),
    slide("section", "section", { tone: "accent", eyebrow: "02", title: "How the product works in practice", subtitle: "From a clip-on sensor to a ranked weekly fix list." }),
    slide("statement", "statement", { eyebrow: "The problem", title: "Most leaks are found eight months too late, after the damage is done.", body: "Slow leaks hide behind walls until a tenant sees a stain. By then the repair costs ten times more." }),
    slide("points3", "points", { eyebrow: "Goals", title: "Three outcomes this project must deliver", points: [{ title: "Win wholesale accounts", text: "A confident brand and a trade page that answers every buyer question." }, { title: "Sell more online", text: "Make subscriptions the obvious way to buy beans every month." }, { title: "Stay recognisably local", text: "Keep the harbour story that regulars already love." }] }),
    slide("points6", "points", { eyebrow: "Deliverables", title: "Everything you need to launch", points: Array.from({ length: 6 }, (_, i) => ({ title: ["Identity", "Packaging", "Website", "Photography", "Launch kit", "Training"][i], text: "Logo suite, colour, type and a short brand book for the whole team." })) }),
    slide("split", "split", { eyebrow: "Solution", title: "Clip-on sensors and one weekly fix list", image: "art", imageSide: "right", points: [{ title: "Installs in an afternoon", text: "Battery sensors clip onto existing pipes; no plumber needed." }, { title: "Learns each building", text: "Flow patterns reveal leaks within days, not months." }, { title: "Tells you what to fix", text: "A ranked weekly report with each leak's likely location." }] }),
    slide("stats", "stats", { tone: "dark", eyebrow: "Market", title: "Mid-size owners are big and ignored", stats: [{ value: "$14B", label: "Water-damage claims a year", detail: "Illustrative estimate" }, { value: "380K", label: "Mid-size buildings", detail: "20–200 units each" }, { value: "23%", label: "Of water bills wasted", detail: "Illustrative pilot baseline" }, { value: "10 wks", label: "To payback" }] }),
    slide("chart", "chart", { eyebrow: "Traction", body: "21% average saving by month six.", chart: { type: "column", categories: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], series: [{ name: "Saving", values: [4, 8, 12, 15, 19, 21] }], unit: "%", highlight: 5, source: "Illustrative pilot data" } }),
    slide("process", "diagram", { eyebrow: "How it works", title: "From pipe to plumber in four steps", diagram: { kind: "process", items: [{ label: "Sense", detail: "Sensors sample flow every minute." }, { label: "Detect", detail: "Models flag flow that never stops." }, { label: "Rank", detail: "Leaks are ordered by likely cost." }, { label: "Act", detail: "Owners book a plumber in one click." }] } }),
    slide("timeline", "diagram", { eyebrow: "Approach", title: "Four phases, one decision at a time", diagram: { kind: "timeline", items: [{ label: "Weeks 1–2", detail: "Discovery workshops and interviews" }, { label: "Weeks 3–5", detail: "Identity and packaging system" }, { label: "Weeks 6–9", detail: "Website design and build" }, { label: "Week 10", detail: "Launch and team training" }] } }),
    slide("compare", "compare", { eyebrow: "Why now", title: "Built for owners, not facility engineers", compare: { left: { heading: "Building systems", points: ["Six-figure installs", "Need on-site engineers", "Designed for towers"] }, right: { heading: "Our service", points: ["Installs in an afternoon", "Weekly plain-language report", "Pays back in one season"] } } }),
    slide("table", "table", { eyebrow: "Why we win", title: "Built for owners, not facility engineers", table: { columns: ["", "Manual checks", "Building systems", "Our service"], rows: [["Install", "None", "Months, six figures", "One afternoon"], ["Finds hidden leaks", "Rarely", "Yes", "Yes, within days"], ["Who reads it", "Maintenance staff", "On-site engineers", "Owners and managers"], ["Payback", "—", "Years", "One season"], ["Reporting", "Paper logs", "Dashboards", "Weekly fix list"]], highlight: 3 } }),
    slide("pricing", "pricing", { eyebrow: "Investment", title: "Three ways to start", tiers: [{ name: "Brand only", price: "$18,000", period: "6 weeks", description: "A new identity and packaging system.", features: ["Identity and brand book", "Packaging system", "Two review rounds"] }, { name: "Brand + website", price: "$42,000", period: "10 weeks", description: "Everything in Brand only, plus the site that wins wholesale.", features: ["Shop and subscriptions", "Wholesale enquiry flow", "Photography day", "Team training"], highlight: true }, { name: "Retainer", price: "$4,500", period: "per month", description: "Ongoing design support after launch.", features: ["Campaign design", "Monthly review", "Priority changes"] }] }),
    slide("team", "team", { eyebrow: "Team", title: "Operators who have fixed this before", people: [{ name: "Maya Ortiz", role: "Chief executive", detail: "Ran maintenance for 4,000 apartment units." }, { name: "Daniel Reyes", role: "Chief technology officer", detail: "Built sensor firmware for a smart-meter company." }, { name: "Priya Shah", role: "Head of sales", detail: "Sold software to regional property managers." }] }),
    slide("team6", "team", { eyebrow: "Advisers", title: "People who will help us scale", people: Array.from({ length: 6 }, (_, i) => ({ name: ["Ana Lima", "Ben Okafor", "Chloé Martin", "Dev Patel", "Eva Novak", "Femi Ade"][i], role: "Adviser, property", detail: "Former operator at a national landlord." })) }),
    slide("quote", "quote", { title: "What clients say", quote: { text: "They understood our customers better than we did after two workshops.", attribution: "Founder, regional bakery (illustrative)" } }),
    slide("image", "image", { image: "art", eyebrow: "Field notes", title: "Every building tells us where it leaks", subtitle: "Forty sensors, one afternoon, a full map of flow." }),
    slide("closing", "closing", { tone: "dark", eyebrow: "The ask", title: "$2.5M to reach 600 buildings", body: "18 months of runway to prove the insurance channel and open three new metros." }),
  ];
}

const deck = (fonts, motif) => ({
  kind: "deck", schemaVersion: 1, title: "Design quality fixture", author: "Synthetic studio",
  theme: { palette, fonts, mood: "", imageStyle: "", ...(motif ? { motif } : {}) },
  slides: deckSlides(), assets: [{ name: "art", id: "00000000-0000-4000-8000-0000000000a1", aspect: "landscape", alt: "Abstract artwork", prompt: "" }],
});

const book = (fonts, motif) => ({
  kind: "book", schemaVersion: 1, title: "The Calm Money Reset", subtitle: "A weekend guide to steady cash flow", author: "Synthetic author", cover: { tagline: "Free guide" },
  theme: { palette, fonts, mood: "", imageStyle: "", ...(motif ? { motif } : {}) }, assets: [],
  chapters: [
    { id: "one", title: "Why freelance money feels chaotic", text: "Most freelancers do not have a spending problem. They have a timing problem. Money arrives in lumps while rent and software arrive with the steady rhythm of a metronome, and that mismatch makes a healthy business feel fragile.\n\n## The three numbers that matter\n\nFind three numbers before changing anything.\n\n1. **Your baseline month.** What an ordinary month costs.\n2. **Your average income.** Twelve months divided by twelve.\n\n[[pullquote:The goal is not to earn more next month. The goal is to make next month boring.|A client]]\n\n> Beware of little expenses.\n> — Benjamin Franklin\n\n[[note:Try this first|Write your baseline month on a sticky note.]]\n\n| Account | What lands here |\n|---|---|\n| Income | Every client payment |\n| Tax | A fixed share of each payment |" },
    { id: "two", opening: "inline", title: "Four accounts, one direction of travel", text: "The simplest structure that works has four accounts, and money only flows one way through them, which keeps it easy to understand when you are tired, busy or travelling.\n\n## Setting the percentages\n\nStart with tax, because it is the one mistake that compounds." },
  ],
});

/** Same layouts with copy dominated by wide glyphs (m, w, capitals): the case that average-width estimates miss. */
const wide = value => value.replace(/[a-z]+/g, word => word.length > 3 ? word.replace(/[aeiou]/g, "m").replace(/[lit]/g, "w") : word);
function wideDeck(fonts, motif) {
  const doc = deck(fonts, motif);
  const walk = (value, key) => typeof value === "string" ? (["id", "layout", "tone", "image", "imageSide", "name", "type", "kind", "unit", "unitPosition"].includes(key) ? value : wide(value))
    : Array.isArray(value) ? value.map(item => walk(item, key)) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)])) : value;
  doc.slides = doc.slides.map(slide => ({ ...walk(slide), notes }));
  doc.slides[2].title = "MOST LEAKS ARE FOUND MONTHS TOO LATE";
  return doc;
}

module.exports = { deck, wideDeck, book, palette, deckSlides };
