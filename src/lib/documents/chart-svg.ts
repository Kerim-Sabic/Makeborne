import type { Chart } from "./schema";
import type { ChartColors, ChartStyle } from "./scene-kit";

export const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function formatValue(chart: Pick<Chart, "unit" | "unitPosition"> & { series?: Chart["series"] }, value: number) {
  const values = chart.series?.flatMap(series => series.values) ?? [value];
  const top = Math.max(...values.map(Math.abs)), fractional = values.some(entry => !Number.isInteger(entry));
  const digits = top < 1 ? 2 : top < 100 && fractional ? 1 : 0;
  const number = value.toLocaleString("en-US", { minimumFractionDigits: fractional ? digits : 0, maximumFractionDigits: digits });
  if (!chart.unit) return number;
  const prefix = chart.unitPosition === "prefix" || (!chart.unitPosition && /^[$€£¥]/.test(chart.unit));
  return prefix ? `${chart.unit}${number}` : /^[A-Za-z]/.test(chart.unit) ? `${number} ${chart.unit}` : `${number}${chart.unit}`;
}
const trim = (value: string, max: number) => value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value;

/** Native-looking SVG chart for the preview and PDF; the PPTX writer emits a
 * real editable chart with the same data, colors and emphasis. */
export function chartSvg(chart: Chart, width: number, height: number, colors: ChartColors, fonts: { heading: string; body: string; headingWeight?: number }, style: ChartStyle = { radius: 3, grid: false }) {
  const parts: string[] = [], rx = style.radius;
  // Label sizes (and the room they take) scale together; the donut keeps its own proportions.
  const k = chart.type === "donut" ? 1 : style.text ?? 1, s = (size: number) => Math.round(size * k * 10) / 10;
  // A light display face (Instrument Serif has one weight) keeps its own weight: never a synthesized bold.
  const t = (x: number, y: number, value: string, size: number, color: string, anchor: "start" | "middle" | "end" = "middle", weight = 400, font = fonts.body) =>
    parts.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${font === fonts.heading && fonts.headingWeight !== undefined && fonts.headingWeight < 600 ? fonts.headingWeight : weight}" font-family="${esc(font)}">${esc(value)}</text>`);
  const multi = chart.series.length > 1;
  const legendH = multi ? s(34) : 0;
  if (multi) {
    let x = 0;
    chart.series.forEach((series, i) => {
      parts.push(`<rect x="${x}" y="${s(4)}" width="${s(14)}" height="${s(14)}" rx="2" fill="${colors.series[i]}"/>`);
      t(x + s(22), s(16), series.name, s(15), colors.ink, "start", 600);
      x += s(40) + series.name.length * s(8.5);
    });
  }
  const n = chart.categories.length;
  const all = chart.series.flatMap(series => series.values);
  let max = Math.max(0, ...all), min = Math.min(0, ...all), tick = 0;
  if (chart.type === "line") {
    const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo || Math.abs(hi) || 1) * 0.18;
    min = lo >= 0 && lo - pad < 0 ? 0 : lo - pad; max = hi + pad;
    // Round axis ticks (1, 2 or 5 × a power of ten) instead of arbitrary quarter values.
    const raw = (max - min) / 4, power = 10 ** Math.floor(Math.log10(raw || 1)), unit = raw / power;
    tick = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
    min = Math.floor(min / tick) * tick; max = Math.ceil(max / tick) * tick;
  }
  const span = max - min || 1;
  const barColor = (series: number, index: number) => multi ? colors.series[series] : chart.highlight === undefined ? colors.series[0] : index === chart.highlight ? colors.highlight : colors.dim;

  if (chart.type === "column") {
    const top = legendH + s(30), bottom = height - s(44), plotH = bottom - top, group = width / n, barW = Math.min(110, group * 0.64 / chart.series.length);
    const zero = top + plotH * (max / span);
    // A quiet value grid for analytical directions; the bars still carry their own labels.
    if (style.grid) for (let g = 1; g <= 3; g++) { const gy = zero - plotH * (max / span) * g / 3; if (gy > top - 1) parts.push(`<line x1="0" x2="${width}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="${colors.grid}" stroke-width="1" stroke-dasharray="2 5"/>`); }
    const labelSize = Math.max(11, Math.min(s(15), (group - 8) / (Math.max(...chart.categories.map(c => c.length)) * 0.55)));
    chart.categories.forEach((category, i) => {
      const gx = i * group + (group - barW * chart.series.length) / 2;
      chart.series.forEach((series, si) => {
        const value = series.values[i], h = Math.abs(value) / span * plotH, x = gx + si * barW, y = value >= 0 ? zero - h : zero;
        parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - (multi ? 4 : 0)).toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="${Math.min(rx, barW / 2)}" fill="${barColor(si, i)}"/>`);
        const emphasis = !multi && chart.highlight === i;
        t(x + (barW - (multi ? 4 : 0)) / 2, value >= 0 ? y - s(10) : y + h + s(20), formatValue(chart, value), s(multi ? 13 : emphasis ? 22 : 16), emphasis ? colors.highlightInk ?? colors.highlight : colors.ink, "middle", 700, emphasis ? fonts.heading : fonts.body);
      });
      t(i * group + group / 2, height - s(16), trim(category, Math.floor(group / (labelSize * 0.55))), labelSize, colors.muted);
    });
    parts.push(`<line x1="0" x2="${width}" y1="${zero.toFixed(1)}" y2="${zero.toFixed(1)}" stroke="${colors.ink}" stroke-width="1.5"/>`);
  } else if (chart.type === "bar") {
    const labelW = Math.min(width * 0.32, 250), left = labelW + 16, right = width - s(80), top = legendH + 4, row = (height - top) / n;
    const barH = Math.min(46, row * 0.62 / chart.series.length), zero = left + (right - left) * (-min / span);
    chart.categories.forEach((category, i) => {
      const gy = top + i * row + (row - barH * chart.series.length) / 2;
      t(labelW, gy + barH * chart.series.length / 2 + s(5), trim(category, Math.floor(labelW / s(8))), s(15), colors.ink, "end", chart.highlight === i ? 700 : 400);
      chart.series.forEach((series, si) => {
        const value = series.values[i], w = Math.abs(value) / span * (right - left), y = gy + si * barH, x = value >= 0 ? zero : zero - w;
        parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, w).toFixed(1)}" height="${(barH - (multi ? 3 : 0)).toFixed(1)}" rx="${Math.min(rx, barH / 2)}" fill="${barColor(si, i)}"/>`);
        t(value >= 0 ? x + w + 8 : x - 8, y + barH / 2 + s(5), formatValue(chart, value), s(multi ? 13 : 15), colors.ink, value >= 0 ? "start" : "end", 700);
      });
    });
    parts.push(`<line x1="${zero.toFixed(1)}" x2="${zero.toFixed(1)}" y1="${top}" y2="${height}" stroke="${colors.grid}" stroke-width="1.5"/>`);
  } else if (chart.type === "line") {
    const left = s(56), top = legendH + s(24), bottom = height - s(44), right = width - s(24), plotH = bottom - top;
    const x = (i: number) => left + (n === 1 ? 0 : i * (right - left) / (n - 1)), y = (v: number) => bottom - (v - min) / span * plotH;
    const ticks = Math.max(1, Math.round(span / (tick || span / 4)));
    for (let g = 0; g <= ticks; g++) {
      const value = min + span * g / ticks, gy = y(value);
      parts.push(`<line x1="${left}" x2="${right}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="${colors.grid}" stroke-width="1" ${g ? 'stroke-dasharray="3 5"' : ""}/>`);
      t(left - 10, gy + s(5), formatValue(chart, value), s(13), colors.muted, "end");
    }
    chart.categories.forEach((category, i) => t(x(i), height - s(16), trim(category, Math.floor((right - left) / n / s(7.5))), s(14), colors.muted));
    chart.series.forEach((series, si) => {
      const color = multi ? colors.series[si] : colors.series[0];
      const points = series.values.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
      if (!multi) parts.push(`<polygon points="${x(0).toFixed(1)},${bottom} ${points} ${x(n - 1).toFixed(1)},${bottom}" fill="${color}" fill-opacity="0.1"/>`);
      parts.push(`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`);
      series.values.forEach((value, i) => {
        const emphasise = i === n - 1 || i === chart.highlight;
        parts.push(`<circle cx="${x(i).toFixed(1)}" cy="${y(value).toFixed(1)}" r="${emphasise ? 7 : 4.5}" fill="${emphasise ? color : colors.background}" stroke="${color}" stroke-width="3"/>`);
        if (emphasise) t(x(i), y(value) - s(16), formatValue(chart, value), s(16), colors.ink, i === n - 1 ? "end" : "middle", 700);
      });
    });
  } else {
    const values = chart.series[0].values, total = values.reduce((sum, value) => sum + value, 0) || 1;
    const r = Math.min(height / 2 - 24, width * 0.22), cx = r + 8, cy = height / 2, inner = r * 0.62;
    const palette = [colors.series[0], colors.series[1], colors.series[2], colors.dim, colors.muted, colors.grid];
    let angle = -Math.PI / 2;
    values.forEach((value, i) => {
      const sweep = value / total * Math.PI * 2;
      if (sweep <= 0) return;
      const end = angle + Math.min(sweep, Math.PI * 2 - 0.0001), large = sweep > Math.PI ? 1 : 0;
      const p = (a: number, radius: number) => `${(cx + radius * Math.cos(a)).toFixed(2)},${(cy + radius * Math.sin(a)).toFixed(2)}`;
      const color = chart.highlight === undefined ? palette[i] : i === chart.highlight ? colors.highlight : palette[(i + 1) % palette.length];
      parts.push(`<path d="M${p(angle, r)} A${r},${r} 0 ${large} 1 ${p(end, r)} L${p(end, inner)} A${inner},${inner} 0 ${large} 0 ${p(angle, inner)} Z" fill="${color}" stroke="${colors.background}" stroke-width="3"/>`);
      angle = end;
    });
    const focus = chart.highlight ?? values.indexOf(Math.max(...values));
    t(cx, cy + 8, `${Math.round(values[focus] / total * 100)}%`, Math.round(inner * 0.5), colors.ink, "middle", 700, fonts.heading);
    t(cx, cy + 8 + inner * 0.36, trim(chart.categories[focus], 18), 14, colors.muted);
    const lx = cx + r + 48, row = Math.min(54, (height - 20) / values.length), ly0 = cy - row * values.length / 2;
    values.forEach((value, i) => {
      const color = chart.highlight === undefined ? palette[i] : i === chart.highlight ? colors.highlight : palette[(i + 1) % palette.length];
      parts.push(`<rect x="${lx}" y="${(ly0 + i * row + 6).toFixed(1)}" width="16" height="16" rx="3" fill="${color}"/>`);
      t(lx + 28, ly0 + i * row + 20, trim(chart.categories[i], Math.floor((width - lx - 120) / 8.5)), 16, colors.ink, "start", i === chart.highlight ? 700 : 400);
      t(width, ly0 + i * row + 20, formatValue(chart, value), 16, colors.ink, "end", 700);
    });
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(chart.type)} chart">${parts.join("")}</svg>`;
}
