import type { Kind, Style } from "../components/studio-model";
import { templateDirections } from "./template-directions";
import { curatedStyles } from "./curated-styles";

/** Saved customisations take precedence; only missing authored directions are added. */
export function creationStyles(saved: Style[], kind?: Kind): Style[] {
  const ids = new Set(saved.map(style => style.id));
  const authored = [...templateDirections, ...curatedStyles];
  const options = [...saved, ...authored.filter(item => !ids.has(item.style.id)).map(item => ({ ...item.style }))];
  if (!kind) return options;
  const suggested = new Set(authored.filter(item => item.kind === kind).map(item => item.style.id));
  // Stable partition: do not reorder saved custom styles relative to each other.
  return [...options.filter(style => suggested.has(style.id)), ...options.filter(style => !suggested.has(style.id))];
}

/** Do not imply the original concept represents a customised palette or typography. */
export function styleConcept(style: Style) {
  return templateDirections.find(({ style: original }) =>
    original.id === style.id && original.color === style.color &&
    original.background === style.background && original.textColor === style.textColor &&
    original.font === style.font);
}

export function retainCreationStyle(saved: Style[], selectedId: string): Style[] {
  if (saved.some(style => style.id === selectedId)) return saved;
  const selected = creationStyles(saved).find(style => style.id === selectedId);
  if (!selected) throw new Error("Choose an available style before creating this project.");
  return [...saved, { ...selected }];
}
