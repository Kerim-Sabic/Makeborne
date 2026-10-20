export type StudioSkipTarget = { id: "studio-brief" | "studio-library" | "studio-content"; label: string };

/**
 * Keyboard bypass links for the outer studio shell, chosen by what the page is showing.
 * Each id names an element that is mounted in that state and can take focus:
 * the brief textarea, the project library toolbar (tabIndex -1) or the main landmark (tabIndex -1).
 */
export function studioSkipTargets({ loaded, tab, composerVisible }: { loaded: boolean; tab: string; composerVisible: boolean }): StudioSkipTarget[] {
  if (!loaded) return [{ id: "studio-content", label: "Skip to main content" }];
  if (tab === "projects" && composerVisible) return [
    { id: "studio-brief", label: "Skip to project brief" },
    { id: "studio-library", label: "Skip to your projects" },
  ];
  return [{ id: "studio-content", label: "Skip to main content" }];
}
