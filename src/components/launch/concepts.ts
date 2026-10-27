/**
 * Decorative imagery for the launch screen's spotlight: the owner's style-concept stills, unlabelled. They are not
 * Makeborne output, so nothing on the page may caption or imply that. Descriptions are neutral (the layer itself is
 * decorative and hidden from assistive technology).
 */
export const CONCEPTS = [
  { id: "r-bikes", alt: "Bike repair shop website design" },
  { id: "r-cat", alt: "Picture book cover with a cat and a lighthouse" },
  { id: "r-dogs", alt: "Dog walking website design" },
  { id: "r-florist", alt: "Florist website design" },
  { id: "r-fungi", alt: "Mushroom field guide cover" },
  { id: "r-gym", alt: "Boxing gym website design" },
  { id: "r-mars", alt: "Presentation slide with a lemonade stand on Mars" },
  { id: "r-ramen", alt: "Ramen restaurant website design" },
  { id: "r-surf", alt: "Surf school website design" },
  { id: "r-whale", alt: "Picture book spread with a whale and a girl" },
  { id: "r-wine", alt: "Wine bar website design" },
  { id: "a-deck1", alt: "Bakery presentation slide with a wood-fired oven" },
] as const;
export type Concept = typeof CONCEPTS[number];

/** A text-free crop of each design's picture side (1280 x 800 WebP, ≤ 110 KB), so no image text collides with the countdown. */
export function conceptSrc(concept: Concept, size: "art") {
  return `/launch/concepts/${concept.id}-${size}.webp`;
}

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
