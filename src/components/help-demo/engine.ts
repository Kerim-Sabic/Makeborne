/**
 * Scripted product demos: a cursor that moves to named targets, clicks, types
 * and drags across an HTML replica of the app. Everything is pre-written; no
 * AI runs. Scenes mark targets with data-demo="name".
 */
export type DemoState = Record<string, string | number | boolean | string[]>;

export type DemoStep =
  /** Show a caption (stays until the next one). Optional on every step. */
  { caption?: string } & (
    | { do: "move"; target: string; ms?: number }
    | { do: "click"; target: string; patch?: DemoState; ms?: number }
    | { do: "type"; target: string; field: string; text: string; ms?: number }
    /** The ghost is the card that follows the cursor while dragging. */
    | { do: "drag"; target: string; to: string; patch?: DemoState; ms?: number; ghost: { title: string; sub?: string } }
    | { do: "wait"; ms: number; patch?: DemoState }
  );

export type DemoScript = {
  id: string;
  title: string;
  /** Targets are data-demo names, or a CSS selector prefixed with "@" for parts of real app components. */
  /** Browser address shown in the replica's toolbar. */
  address: string;
  initial: DemoState;
  steps: DemoStep[];
};

/** The captions in order: the text alternative for the animation (and what search engines read). */
export const captionsOf = (script: DemoScript) => script.steps.map(step => step.caption).filter((caption): caption is string => Boolean(caption));
