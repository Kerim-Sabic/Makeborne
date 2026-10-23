import type { ElementLoc } from "./visual-edit";
import type { WebsiteProjectSource } from "../projects/website-source";

/** Click-to-edit state for one website that can outlive a mounted preview: the editor keeps it while
 * another tab is open (which unmounts the preview), so edit mode, Undo and the selection are still there. */
export type VisualEditSession = {
  editing: boolean;
  /** The source the last edit or undo produced. Undo applies only while that is still the current source. */
  produced: WebsiteProjectSource | null;
  history: { source: WebsiteProjectSource; loc: ElementLoc | null; index: number }[];
  /** The selected element: its source location and which copy of it on the page. */
  selection: { loc: string | null; index: number };
};

export const newVisualEditSession = (): VisualEditSession => ({ editing: false, produced: null, history: [], selection: { loc: null, index: 0 } });
