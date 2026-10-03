/** One continuous rounded M, shared with the favicon and downloadable SVGs. */
export default function BrandMark({
  size = 30,
  tone = "ink",
}: {
  size?: number;
  tone?: "color" | "ink" | "light";
}) {
  const primary = tone === "light" ? "#FFFFFF" : tone === "color" ? "#F76F53" : "#18181B";
  return (
    <svg aria-hidden="true" focusable="false" className="brand-mark" width={size} height={size} viewBox="0 0 64 64" fill="none">
      <path d="M6 50V25C6 14 12 8 22 8C27 8 30 10 32 14C34 10 38 8 43 8C53 8 58 14 58 25V50C58 53 56 55 53 55H51C48 55 46 53 46 50V25C46 21 44 19 41 19C38 19 37 21 37 25V50C37 53 35 55 32 55C29 55 27 53 27 50V25C27 21 25 19 22 19C19 19 18 21 18 25V50C18 53 16 55 13 55H11C8 55 6 53 6 50Z" fill={primary} />
    </svg>
  );
}
