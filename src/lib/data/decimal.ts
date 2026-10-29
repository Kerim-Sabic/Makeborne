/**
 * Exact decimal arithmetic for report figures (money above all): a value is an
 * integer of digits and a decimal scale, so 0.1 + 0.2 is exactly 0.3 and a
 * total never drifts by a cent. Division and rounding are explicit, with one
 * rule everywhere: round half away from zero ("commercial" rounding), to a
 * stated number of places. Nothing here uses floating point for a result.
 */
export type Dec = Readonly<{ digits: bigint; scale: number }>;

const TEN = BigInt(10), ZERO = BigInt(0), ONE = BigInt(1), TWO = BigInt(2);
const pow10 = (n: number) => TEN ** BigInt(n);
const MAX_SCALE = 40;

export const dec = (digits: bigint, scale = 0): Dec => normal({ digits, scale });
function normal(value: Dec): Dec {
  let { digits, scale } = value;
  while (scale > 0 && digits % TEN === ZERO) { digits /= TEN; scale--; }
  return Object.freeze({ digits, scale });
}

/** Plain decimal text ("-12.50", "1234") only; anything else is null. */
export function parseDec(text: string): Dec | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match || (match[3]?.length ?? 0) > MAX_SCALE || match[2].length > 60) return null;
  const fraction = match[3] ?? "";
  return normal({ digits: BigInt(`${match[1] ?? ""}${match[2]}${fraction}`), scale: fraction.length });
}

/** The shortest round-trip form of a saved binary number (what the spreadsheet stored), exactly. */
export function fromNumber(value: number): Dec | null {
  if (!Number.isFinite(value)) return null;
  const text = String(value);
  const exp = /^(-)?(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!exp) return parseDec(text);
  const digits = `${exp[2]}${exp[3] ?? ""}`, shift = Number(exp[4]) - (exp[3]?.length ?? 0);
  return shift >= 0 ? normal({ digits: BigInt(`${exp[1] ?? ""}${digits}`) * pow10(shift), scale: 0 }) : normal({ digits: BigInt(`${exp[1] ?? ""}${digits}`), scale: -shift });
}

export function decText(value: Dec): string {
  const { digits, scale } = normal(value);
  const negative = digits < ZERO, raw = (negative ? -digits : digits).toString().padStart(scale + 1, "0");
  const text = scale ? `${raw.slice(0, -scale)}.${raw.slice(-scale)}` : raw;
  return negative && digits !== ZERO ? `-${text}` : text;
}

const align = (a: Dec, b: Dec) => { const scale = Math.max(a.scale, b.scale); return { a: a.digits * pow10(scale - a.scale), b: b.digits * pow10(scale - b.scale), scale }; };
export const add = (a: Dec, b: Dec): Dec => { const x = align(a, b); return normal({ digits: x.a + x.b, scale: x.scale }); };
export const sub = (a: Dec, b: Dec): Dec => { const x = align(a, b); return normal({ digits: x.a - x.b, scale: x.scale }); };
export const mul = (a: Dec, b: Dec): Dec => normal({ digits: a.digits * b.digits, scale: a.scale + b.scale });
export const neg = (a: Dec): Dec => normal({ digits: -a.digits, scale: a.scale });
export const abs = (a: Dec): Dec => a.digits < ZERO ? neg(a) : a;
export const cmp = (a: Dec, b: Dec): number => { const x = align(a, b); return x.a === x.b ? 0 : x.a < x.b ? -1 : 1; };
export const isZero = (a: Dec) => a.digits === ZERO;
export const sign = (a: Dec) => a.digits === ZERO ? 0 : a.digits < ZERO ? -1 : 1;
/** × 10^places, exactly (a fraction 0.25 → 25 percentage points). */
export function shift(a: Dec, places: number): Dec {
  if (places < 0) return normal({ digits: a.digits, scale: a.scale - places });
  return a.scale >= places ? normal({ digits: a.digits, scale: a.scale - places }) : normal({ digits: a.digits * pow10(places - a.scale), scale: 0 });
}

/** Integer division rounded half away from zero. */
function divRoundInt(numerator: bigint, denominator: bigint): bigint {
  const negative = (numerator < ZERO) !== (denominator < ZERO);
  const n = numerator < ZERO ? -numerator : numerator, d = denominator < ZERO ? -denominator : denominator;
  const quotient = n / d, remainder = n % d;
  const rounded = remainder * TWO >= d ? quotient + ONE : quotient;
  return negative ? -rounded : rounded;
}
/** a / b rounded half away from zero to `places`; null when b is zero (never Infinity). */
export function divide(a: Dec, b: Dec, places: number): Dec | null {
  if (b.digits === ZERO) return null;
  // a/b = (a.d / 10^a.s) / (b.d / 10^b.s); scale the numerator so the integer quotient has `places` decimals.
  const exponent = places + b.scale - a.scale;
  const numerator = exponent >= 0 ? a.digits * pow10(exponent) : a.digits, denominator = exponent >= 0 ? b.digits : b.digits * pow10(-exponent);
  return normal({ digits: divRoundInt(numerator, denominator), scale: places });
}
export function round(a: Dec, places: number): Dec {
  if (a.scale <= places) return a;
  return normal({ digits: divRoundInt(a.digits, pow10(a.scale - places)), scale: places });
}
export const sum = (values: readonly Dec[]): Dec => values.reduce(add, dec(ZERO));
export const toNumber = (a: Dec) => Number(decText(a));

/** "12,345.60": fixed places (padded), thousands grouped with commas. */
export function formatDec(a: Dec, places: number, group = true): string {
  const rounded = round(a, places);
  const text = decText(rounded);
  const negative = text.startsWith("-"), body = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = body.split(".");
  const grouped = group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole;
  const padded = places > 0 ? `.${fraction.padEnd(places, "0")}` : "";
  return `${negative && !isZero(rounded) ? "-" : ""}${grouped}${padded}`;
}
