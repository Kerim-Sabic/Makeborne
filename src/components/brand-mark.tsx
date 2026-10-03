/** Shared vector geometry keeps the identity consistent in every application. */
export default function BrandMark({
  size = 30,
  tone = "color",
}: {
  size?: number;
  tone?: "color" | "ink" | "light";
}) {
  const primary = tone === "light" ? "#FFFFFF" : tone === "ink" ? "#16181D" : "#3358D4";
  const fold = tone === "color" ? "#16181D" : primary;
  return (
    <svg aria-hidden="true" focusable="false" className="brand-mark" width={size} height={size} viewBox="0 0 64 64" fill="none">
      <path d="M6 6L28 27V58H6V6Z" fill={primary} />
      <path d="M28 27L58 6L40 38L28 27Z" fill={fold} />
      <path d="M58 6V58H32L58 6Z" fill={primary} />
    </svg>
  );
}
