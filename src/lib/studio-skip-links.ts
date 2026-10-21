export type StudioSkipTarget = { id: "studio-brief" | "studio-library" | "studio-content"; label: string };

/**
 * Keyboard bypass links for the outer studio shell, chosen by what the page is showing.
 * Each id names an element that is mounted in that state and can take focus:
 * the brief textarea, the project library toolbar (tabIndex -1) or the main landmark (tabIndex -1).
 * `library` says where the library toolbar is: first for returning users, absent for new users.
 */
export function studioSkipTargets({ loaded, tab, composerVisible, library = "none" }: { loaded: boolean; tab: string; composerVisible: boolean; library?: "first" | "none" }): StudioSkipTarget[] {
  if (!loaded) return [{ id: "studio-content", label: "Skip to main content" }];
  if (tab === "projects" && composerVisible) {
    const brief = { id: "studio-brief", label: "Skip to project brief" } as const;
    const projects = { id: "studio-library", label: "Skip to your projects" } as const;
    return library === "first" ? [projects, brief] : [brief];
  }
  return [{ id: "studio-content", label: "Skip to main content" }];
}
