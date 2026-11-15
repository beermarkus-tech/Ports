// Small SVG charts for the Company tab. Each month column carries a `data-tip`
// (shown by the shared tooltip) and a hit target taller than its mark.

import { compactMoney } from './format';

export interface ChartPoint {
  /** Axis label for this column ('' to skip). */
  label: string;
  value: number;
  /** Tooltip HTML for this column. */
  tip: string;
}

const W = 360;
const H = 160;
const PAD = { top: 10, right: 8, bottom: 22, left: 44 };

/** A rounded-but-plain scale: 0 included, three or four gridlines. */
function niceScale(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  let lo = Math.min(0, min), hi = Math.max(0, max);
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? raw;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return { lo, hi, ticks };
}

function frame(points: ChartPoint[], lo: number, hi: number, ticks: number[]) {
  const iw = W - PAD.left - PAD.right, ih = H - PAD.top - PAD.bottom;
  const col = iw / Math.max(1, points.length);
  const x = (i: number) => PAD.left + col * (i + 0.5);
  const y = (v: number) => PAD.top + ih * (1 - (v - lo) / (hi - lo));
  const grid = ticks.map((t) => `<line class="ch-grid${t === 0 ? ' zero' : ''}" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>
    <text class="ch-axis" x="${PAD.left - 6}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${compactMoney(t)}</text>`).join('');
  const labels = points.map((p, i) => p.label ? `<text class="ch-axis" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${p.label}</text>` : '').join('');
  const hits = points.map((p, i) => `<rect class="ch-hit" x="${(PAD.left + col * i).toFixed(1)}" y="${PAD.top}" width="${col.toFixed(1)}" height="${ih}" data-tip="${p.tip.replace(/"/g, '&quot;')}"/>`).join('');
  return { col, x, y, grid, labels, hits };
}

/** Net worth month by month: a 2px line over a faint area, the latest point marked. */
export function lineChart(points: ChartPoint[], aria: string): string {
  if (!points.length) return '';
  const { lo, hi, ticks } = niceScale(Math.min(...points.map((p) => p.value)), Math.max(...points.map((p) => p.value)));
  const f = frame(points, lo, hi, ticks);
  const xy = points.map((p, i) => `${f.x(i).toFixed(1)},${f.y(p.value).toFixed(1)}`);
  const line = points.length > 1 ? `<polyline class="ch-line" points="${xy.join(' ')}"/>` : '';
  const area = points.length > 1
    ? `<polygon class="ch-area" points="${f.x(0).toFixed(1)},${f.y(Math.max(lo, 0)).toFixed(1)} ${xy.join(' ')} ${f.x(points.length - 1).toFixed(1)},${f.y(Math.max(lo, 0)).toFixed(1)}"/>`
    : '';
  const last = points.length - 1;
  const dot = `<circle class="ch-dot" cx="${f.x(last).toFixed(1)}" cy="${f.y(points[last].value).toFixed(1)}" r="4"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">${f.grid}${area}${line}${dot}${f.labels}${f.hits}</svg>`;
}

/** Profit and loss per month: bars from zero, rounded at the data end, teal up and orange down. */
export function barChart(points: ChartPoint[], aria: string): string {
  if (!points.length) return '';
  const { lo, hi, ticks } = niceScale(Math.min(...points.map((p) => p.value)), Math.max(...points.map((p) => p.value)));
  const f = frame(points, lo, hi, ticks);
  const bw = Math.max(3, Math.min(22, f.col - 2));
  const r = Math.min(4, bw / 2);
  const bars = points.map((p, i) => {
    const x0 = f.x(i) - bw / 2, y0 = f.y(0), y1 = f.y(p.value);
    const hgt = Math.abs(y1 - y0);
    if (hgt < 0.5) return '';
    const rr = Math.min(r, hgt);
    // Rounded at the end away from zero, square on the baseline.
    const d = p.value >= 0
      ? `M${x0},${y0} V${y1 + rr} Q${x0},${y1} ${x0 + rr},${y1} H${x0 + bw - rr} Q${x0 + bw},${y1} ${x0 + bw},${y1 + rr} V${y0} Z`
      : `M${x0},${y0} V${y1 - rr} Q${x0},${y1} ${x0 + rr},${y1} H${x0 + bw - rr} Q${x0 + bw},${y1} ${x0 + bw},${y1 - rr} V${y0} Z`;
    return `<path class="ch-bar ${p.value >= 0 ? 'up' : 'down'}" d="${d}"/>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">${f.grid}${bars}${f.labels}${f.hits}</svg>`;
}
