import type { CloudClient } from "../cloud/contracts";

/** Ready-made outreach angles. The style reference is the owner's own proven email, used as a model for tone and structure, never copied. */
export const CAMPAIGNS = {
  audience_value: {
    label: "Creators: what your audience is worth",
    goal: "This person has an audience (creator, coach, influencer, community). Offer to send them a short breakdown of what their audience is worth and 2–3 product ideas that would fit that audience and convert well. The ask: reply YES to get it (a two-minute video).",
    style: `Hey Baoss,

I've been thinking about this for a while. You have an audience that really trusts you, but it seems like there isn't a clear way to turn that into money in your pocket yet. I did a quick breakdown of how much your audience is worth, and a few product ideas that would convert well for you.

Two minutes of your time, about a minute on 2x. If you'd like to see it, just reply YES, and I'll send it over.

Best,
Kerim`,
  },
  website: {
    label: "Businesses: website that wins more customers",
    goal: "This business could win more customers with a better website (clearer offer, works on phones, easy booking or enquiries). Offer a short, specific idea or mock-up for their site. The ask: reply YES to see it.",
    style: "",
  },
  redesign: {
    label: "Businesses: I redesigned your website",
    goal: "I made a free redesign of this business's current website. Mention one or two specific problems with their current site from the site audit below (only ones it lists), say in one sentence what the new version does better for their customers, and offer to send it. The ask: reply YES to see it.",
    style: "",
  },
  custom: { label: "My own angle", goal: "", style: "" },
} as const;
export type Campaign = keyof typeof CAMPAIGNS;

const clip = (value: string, length: number) => value.length > length ? `${value.slice(0, length)}…` : value;

/** The full instruction for one personalised email. Client data and research are delimited and marked as material, never instructions. */
export function buildEmailBrief(input: { client: Pick<CloudClient, "name" | "company" | "website" | "notes" | "outreach">; research: string; goal: string;
  tone: "warm" | "direct" | "formal"; senderName: string; campaign: Campaign }) {
  const { client, campaign } = input, outreach = client.outreach, preset = CAMPAIGNS[campaign];
  const goal = [preset.goal, input.goal].filter(Boolean).join(" Also: ");
  const history = (outreach?.activity ?? []).slice(-6).map(item => `- ${item.at.slice(0, 10)} (${item.type}): ${clip(item.text, 240)}`).join("\n");
  const sign = input.senderName.replace(/["\n]/g, "").trim();
  return [
    `Write one outreach email to this person. Tone: ${input.tone}. ${goal ? `Goal: ${goal}` : "Choose the most useful goal for where we are with them."}`,
    "First, think privately about the research and record: what exactly they do, their niche, who their audience or customers are (and the size if shown), what they sell today if anything, and the one gap between the attention or demand they have and the results they could be getting. Then write.",
    "Rules for the email:",
    "- The first sentence after the greeting must mention one concrete detail only this person would recognise (a specific topic they post about, a phrase from their bio, a product, a number, their city or niche). Never generic praise like \"love your content\".",
    "- Connect the offer to their specific situation and audience, in their world's words. Make the value obvious in one sentence.",
    "- Greet them by first name; if only a handle is known, use the handle. Never invent a name.",
    "- Use only facts from the record and research. Never invent numbers, results, clients or claims about them; if the research is thin, keep the personal detail to what is known.",
    "- Do not claim work is already done unless the goal says so.",
    "- One clear, low-effort ask (for example: reply YES). No links, no attachments, no pressure, no hype. 60–120 words. Short paragraphs. Sounds like one person writing to another.",
    preset.style ? `Style reference (match its rhythm, warmth and structure; do not copy its sentences):\n<style_reference>\n${preset.style}\n</style_reference>` : "",
    `Output exactly this and nothing else:\nSubject: <subject line under 7 words, personal, no clickbait>\n\n<email body as plain text${sign ? `, signed "${sign}"` : ""}>\n---NOTES---\nNiche: <one line>\nAudience: <one line, include size if known>\nAngle: <why this email should land>\nConfidence: <one word: high, medium or low, based on how much real detail you had>\nCheck: <under 20 words on anything to verify or fix before sending, or "none">\nKeep each note to one short line.`,
    "<client_record>",
    `Name: ${client.name}`, client.company ? `Company: ${client.company}` : "", client.website ? `Website: ${client.website}` : "",
    outreach?.profileUrl ? `Profile: ${outreach.profileUrl}` : "", `Stage: ${outreach?.stage ?? "Lead"}`, `Channel: ${outreach?.channel ?? "Not set"}`,
    outreach?.notes ? `Outreach notes: ${clip(outreach.notes, 1200)}` : "", client.notes ? `Client notes: ${clip(client.notes, 800)}` : "",
    history ? `Recent history (oldest first):\n${history}` : "No history yet: this is the first message.",
    "</client_record>",
    input.research || "<public_research>No public pages were linked or readable. Personalise only from the record.</public_research>",
  ].filter(Boolean).join("\n");
}
