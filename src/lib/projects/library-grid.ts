/**
 * Project library grid: how many columns a list of a given width shows, and
 * the small mark beside a card's title. Client-safe and pure.
 *
 * Columns follow the width of the list itself (a CSS container query), never
 * the viewport, so the same list beside a sidebar or in a narrow pane keeps
 * readable cards. `src/app/library-preview.css` writes these same steps; an
 * offline check keeps the two in step. Widths are CSS pixels after the
 * large-screen interface zoom, so a 2560 px screen gets the same columns as a
 * 1600 px one.
 */
export const LIBRARY_COLUMN_STEPS: readonly (readonly [minWidth: number, columns: number])[] = [[1600, 5], [1040, 4], [760, 3], [480, 2]];

export function libraryColumns(listWidth: number): number {
  if (!Number.isFinite(listWidth)) return 1;
  for (const [minWidth, columns] of LIBRARY_COLUMN_STEPS) if (listWidth >= minWidth) return columns;
  return 1;
}

/**
 * The first letter or digit of a project's name, for the small mark beside its
 * title. A placeholder name ("Untitled website") or a name with no letter gets
 * none, and the card shows its format's icon instead.
 */
export function projectInitial(title: string, placeholder: boolean): string | null {
  if (placeholder) return null;
  const match = title.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toLocaleUpperCase() : null;
}
