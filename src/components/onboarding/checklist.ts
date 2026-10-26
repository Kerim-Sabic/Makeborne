import { knownClosed, opensWithAi } from "@/lib/ai/assistant-availability";
import type { BuilderAvailability } from "@/lib/builder/availability";

/** Getting-started progress, counted by the onboarding endpoint (null: that data can't be read here). */
export type Progress = { artifacts: number | null; clients: number | null; finderLeads: number | null; mailboxes: number | null; sentEmails: number | null; reviewLinks: number | null };
type Kind = "website" | "book" | "presentation";

/** `waiting`: the step needs AI that can't start right now; it says so, offers no action and isn't counted. */
export type Step = { id: string; title: string; hint: string; done: boolean; action: string; guide: string; run: () => void; waiting?: string };
/** What the AI helpers report (null: not known yet, so every step stays as it is and the server decides). */
export type AiSteps = { leads: BuilderAvailability | null; advisor: BuilderAvailability | null };

/** The checklist, in the order that gets a new account to its first win fastest. Steps whose data can't be read are left out.
 * While lead finding can't start, its step becomes the path that works without AI (add clients or import a CSV); while advisors
 * can't answer, that step says when it opens instead of sending people to a chat that can't reply. */
export function checklist(progress: Progress, advisor: boolean, go: { create: (kind: Kind) => void; leads: () => void; addClients: () => void; email: () => void; clients: () => void; projects: () => void; chat: () => void },
  ai: AiSteps = { leads: null, advisor: null }): Step[] {
  const leadsClosed = knownClosed(ai.leads), advisorClosed = knownClosed(ai.advisor);
  const steps: (Step | null)[] = [
    progress.artifacts === null ? null : { id: "create", title: "Create your first project", hint: "A website, book or presentation from a short brief.", done: progress.artifacts > 0, action: "Create a website", guide: "create-a-website-with-ai", run: () => go.create("website") },
    progress.clients === null ? null : leadsClosed
      ? { id: "leads", title: "Add your first clients", hint: "Lead finding needs AI, which isn’t available right now. Add clients yourself or import your list from a CSV file.", done: (progress.finderLeads ?? 0) > 0 || progress.clients > 0, action: "Add clients", guide: "import-clients-from-csv", run: go.addClients }
      : { id: "leads", title: "Find your first 10 leads", hint: "Real businesses or creators, checked and ranked for what you sell.", done: (progress.finderLeads ?? 0) > 0 || progress.clients >= 10, action: "Find leads", guide: "find-new-leads", run: go.leads },
    progress.mailboxes === null ? null : { id: "email", title: "Connect your email", hint: "Send from your own Gmail or Outlook. Sending is free.", done: progress.mailboxes > 0, action: "Connect", guide: "connect-gmail-or-outlook", run: go.email },
    progress.sentEmails === null ? null : { id: "send", title: "Send your first personal email", hint: "Select leads, then choose Write personal emails.", done: progress.sentEmails > 0, action: "Write emails", guide: "send-personal-outreach-emails", run: go.clients },
    progress.reviewLinks === null ? null : { id: "review", title: "Share work for review", hint: "Open a project and choose Client review in its ••• menu: your client comments and approves, no account needed.", done: progress.reviewLinks > 0, action: "Open projects", guide: "share-work-for-client-review", run: go.projects },
    { id: "advisor", title: "Ask an advisor", hint: "Pricing, positioning or sales advice in seconds.", done: advisor, action: "Ask", guide: "ask-an-ai-advisor", run: go.chat,
      ...(advisorClosed && !advisor ? { waiting: opensWithAi(ai.advisor!) } : {}) },
  ];
  return steps.filter((step): step is Step => step !== null);
}
