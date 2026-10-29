/**
 * Decorative imagery for the launch screen's spotlight: the owner's website designs, shown whole (navigation,
 * headline and picture) inside a plain browser frame, unlabelled. They are not Makeborne output, so nothing on the page
 * may caption or imply that. Descriptions are neutral (the layer itself is decorative and hidden from assistive technology).
 */
export const CONCEPTS = [
  { id: "r-bikes", alt: "Bike repair shop website design" },
  { id: "r-dogs", alt: "Dog walking website design" },
  { id: "r-florist", alt: "Florist website design" },
  { id: "r-gallery", alt: "Art gallery website design" },
  { id: "r-gym", alt: "Boxing gym website design" },
  { id: "r-ramen", alt: "Ramen restaurant website design" },
  { id: "r-surf", alt: "Surf school website design" },
  { id: "r-tea", alt: "Tea house website design" },
  { id: "r-wine", alt: "Wine bar website design" },
] as const;
export type Concept = typeof CONCEPTS[number];

/** The whole design, nothing cropped (1440 x 810 WebP, ≤ 170 KB). */
export function conceptSrc(concept: Concept, size: "site") {
  return `/launch/concepts/${concept.id}-${size}.webp`;
}

/**
 * Where each window sits, as a share of the free space left and top: never the same spot twice in a row and never
 * centred under the clock, so a visitor has to go looking for it.
 */
export const WINDOW_SPOTS: readonly (readonly [number, number])[] = [[0.06, 0.16], [0.94, 0.84], [0.1, 0.9], [0.92, 0.1], [0.04, 0.55], [0.96, 0.45]];

/** A fresh order for each visit (Fisher–Yates with the given random source). */
export function shuffledConcepts(random: () => number = Math.random): Concept[] {
  const order: Concept[] = [...CONCEPTS];
  for (let index = order.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [order[index], order[other]] = [order[other], order[index]];
  }
  return order;
}

/** Warms the browser cache for one image (the next one only); resolves when it can be painted without a flash. */
export function preloadConcept(src: string): Promise<void> {
  return new Promise(resolve => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => { if (typeof image.decode === "function") void image.decode().catch(() => undefined).then(() => resolve()); else resolve(); };
    image.onerror = () => resolve();
    image.src = src;
  });
}
