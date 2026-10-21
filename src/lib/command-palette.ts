/** Commands for the global palette (Ctrl/⌘+K). Pure; client-safe. */
export type PaletteCommand = {
  id: string;
  label: string;
  group: "Go to" | "Start" | "Projects" | "Advisors";
  hint?: string;
  keywords?: readonly string[];
  /** Navigates or opens a composer. Never sends a request or starts paid work. */
  run: () => void;
};

const normal = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const MAX_PALETTE_RESULTS = 30;

/** Every word of the query must match the label, group or keywords; label matches rank first. */
export function matchCommands<T extends Pick<PaletteCommand, "label" | "group" | "keywords">>(commands: readonly T[], query: string, limit = MAX_PALETTE_RESULTS): T[] {
  const words = normal(query).split(/\s+/).filter(Boolean);
  if (!words.length) return commands.slice(0, limit);
  const scored: { command: T; score: number; index: number }[] = [];
  commands.forEach((command, index) => {
    const label = normal(command.label), rest = normal([command.group, ...(command.keywords ?? [])].join(" "));
    let score = 0;
    for (const word of words) {
      if (label.startsWith(word) || label.includes(` ${word}`)) score += 3;
      else if (label.includes(word)) score += 2;
      else if (rest.includes(word)) score += 1;
      else return;
    }
    scored.push({ command, score, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map(entry => entry.command);
}
