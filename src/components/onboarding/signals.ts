"use client";

/**
 * One-shot requests from the getting-started checklist to the Clients page
 * ("open the lead finder", "show Email"). Kept in session storage too, so the
 * request survives the Clients page mounting after the click.
 */
export type ClientsAction = "find-leads" | "email";
const KEY = "makeborne.clients-action";
export const CLIENTS_ACTION_EVENT = "makeborne:clients-action";
/** Fired by the Clients page when something that moves the checklist happens (clients added, email sent). */
export const ONBOARDING_REFRESH_EVENT = "makeborne:onboarding-refresh";

export type LeadFinderSeed = { name: string; url: string; about: string };
export type ClientsRequest = { action: ClientsAction; seed?: LeadFinderSeed };

export function requestClientsAction(action: ClientsAction, seed?: LeadFinderSeed) {
  const request: ClientsRequest = { action, ...(seed ? { seed } : {}) };
  try { sessionStorage.setItem(KEY, JSON.stringify(request)); } catch { /* storage unavailable: the event still works while mounted */ }
  window.dispatchEvent(new CustomEvent(CLIENTS_ACTION_EVENT, { detail: request }));
}

/** Returns the pending request once, then forgets it. */
export function takeClientsAction(): ClientsRequest | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const value = raw ? JSON.parse(raw) as ClientsRequest : null;
    return value && (value.action === "find-leads" || value.action === "email") ? value : null;
  } catch { return null; }
}

export function refreshOnboarding() { window.dispatchEvent(new Event(ONBOARDING_REFRESH_EVENT)); }
