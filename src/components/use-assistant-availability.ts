"use client";
import { useEffect, useState } from "react";
import { parseAssistantAvailability, type AssistantAvailability } from "@/lib/ai/assistant-availability";

const FRESH_MS = 60_000;
let cached: { at: number; value: Promise<AssistantAvailability | null> } | null = null;
const read = (path: string) => fetch(path, { cache: "no-store" }).then(response => response.ok ? response.json() : Promise.reject(new Error(String(response.status))));

/** One read per minute for the whole page (welcome, checklist and lead finder share it). null: unknown, so nothing is blocked. */
export function readAssistantAvailability(): Promise<AssistantAvailability | null> {
  if (!cached || Date.now() - cached.at > FRESH_MS) {
    const value = Promise.all([read("/api/assistants"), read("/api/build")]).then(([assistants, build]) => parseAssistantAvailability(assistants, build), () => null);
    cached = { at: Date.now(), value };
  }
  return cached.value;
}

export function useAssistantAvailability(): AssistantAvailability | null {
  const [value, setValue] = useState<AssistantAvailability | null>(null);
  useEffect(() => {
    let live = true;
    void readAssistantAvailability().then(next => { if (live) setValue(next); });
    return () => { live = false; };
  }, []);
  return value;
}
