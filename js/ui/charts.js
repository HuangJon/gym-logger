/** SVG charts, returned as strings. Colors come from CSS classes so light/dark mode just works. */
import { dayNum, formatShort, formatMonthDay } from '../core/dates.js';
import { hasValue, round2 } from '../core/numbers.js';
import { esc } from './dom.js';

const MAX_LABELED_POINTS = 30;

/**
 * Line chart over time.
 * @param {object[]} points  oldest first, each with a `date`
 * @param {object} o
 * @param {(p)=>number} o.valueOf        y value
 * @param {(p)=>string} [o.labelOf]      text above each dot (when there's room)
 * @param {(p)=>string} [o.zoneOf]       'top'|'mid'|'low'|'none' → dot/label color
 * @param {(p)=>string} [o.tipOf]        tooltip text for each dot
 * @param {[number,number]} [o.band]     shaded target band (e.g. rep range)
 * @param {'levels'|'minmax'} [o.grid]  'levels' = a labeled line at every distinct value (≤6)
 * @param {boolean} [o.tagChanges]       print the new value under a dot when it changes
 * @param {number} [o.minSpan]           smallest y range, so flat lines don't look jagged
 */
export function lineChart(points, { valueOf, labelOf, zoneOf = () => 'none', tipOf = () => '', band, grid = 'minmax', tagChanges = false, minSpan = 4 }) {
  const pts = points.filter(p => hasValue(valueOf(p)));
  if (!pts.length) return '';
  const W = 320, H = 132, L = 32, R = 12, T = 18, B = 26;
  const xs = pts.map(p => dayNum(p.date)), ys = pts.map(p => Number(valueOf(p)));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (band) { y0 = Math.min(y0, band[0]); y1 = Math.max(y1, band[1]); }
  if (y1 - y0 < minSpan) { const mid = (y0 + y1) / 2; y0 = mid - minSpan / 2; y1 = mid + minSpan / 2; }
  const pad = (y1 - y0) * 0.12; y0 -= pad; y1 += pad;
  const X = d => (x1 === x0 ? (L + W - R) / 2 : L + ((d - x0) / (x1 - x0)) * (W - L - R));
  const Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const showLabels = labelOf && pts.length <= MAX_LABELED_POINTS;
  const lo = Math.min(...ys), hi = Math.max(...ys);

  let levels;
  if (grid === 'levels') {
    const distinct = [...new Set(ys)].sort((a, b) => a - b);
    levels = (distinct.length <= 6 ? distinct : [lo, hi]).filter((v, i, arr) => i === 0 || Y(arr[i - 1]) - Y(v) >= 9);
  } else {
    levels = lo === hi ? [hi] : [lo, hi];
  }
  const showAxis = grid === 'levels' || !showLabels;
  const gridSvg = levels.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="chart-grid"/>` +
    (showAxis ? `<text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end" class="chart-axis">${round2(v)}</text>` : '')).join('');

  const bandSvg = band ? `<rect x="${L}" width="${W - R - L}" y="${Y(band[1]).toFixed(1)}" height="${Math.max(2, Y(band[0]) - Y(band[1])).toFixed(1)}" class="chart-band"/>` : '';
  const lineSvg = pts.length > 1 ? `<polyline points="${pts.map((p, i) => `${X(xs[i]).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join(' ')}" class="chart-line"/>` : '';
  const tagsSvg = tagChanges ? pts.map((p, i) => i > 0 && ys[i] !== ys[i - 1]
    ? `<text x="${X(xs[i]).toFixed(1)}" y="${(Y(ys[i]) + 14).toFixed(1)}" text-anchor="middle" class="chart-tag">${round2(ys[i])}</text>` : '').join('') : '';
  const dotsSvg = pts.map((p, i) => {
    const x = X(xs[i]).toFixed(1), y = Y(ys[i]), zone = `zone-${zoneOf(p)}`, label = showLabels ? labelOf(p) : '';
    return `<g><title>${esc(tipOf(p))}</title>
      <circle cx="${x}" cy="${y.toFixed(1)}" r="4" class="chart-dot ${zone}${p.status === 'partial' ? ' partial' : ''}${p.deload ? ' deload' : ''}"/>
      ${hasValue(label) && label !== '' ? `<text x="${x}" y="${(y - 7).toFixed(1)}" text-anchor="middle" class="chart-lbl ${zone}">${esc(label)}</text>` : ''}</g>`;
  }).join('');
  const datesSvg = `<text x="${L}" y="${H - 4}" class="chart-axis">${formatShort(pts[0].date)}</text>` +
    (pts.length > 1 ? `<text x="${W - R}" y="${H - 4}" class="chart-axis" text-anchor="end">${formatShort(pts[pts.length - 1].date)}</text>` : '');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${bandSvg}${gridSvg}${datesSvg}${tagsSvg}${lineSvg}${dotsSvg}</svg>`;
}

/** Bar chart of sessions per week with a dashed goal line. weeks: [{ start: ISO date, count }] */
export function weeklyBarsChart(weeks, goal) {
  const W = 320, H = 80, barW = 28, gap = (W - barW * weeks.length) / (weeks.length - 1);
  const max = Math.max(goal, ...weeks.map(w => w.count));
  const barTop = n => H - 14 - (n / max) * (H - 26);
  const bars = weeks.map((w, i) => {
    const x = i * (barW + gap), y = barTop(w.count), h = Math.max((w.count / max) * (H - 26), 1.5);
    return `<g><title>Week of ${formatMonthDay(w.start)}: ${w.count} session${w.count === 1 ? '' : 's'}</title>
      <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" class="${i === weeks.length - 1 ? 'bar bar-now' : 'bar'}"/>
      ${w.count ? `<text x="${x + barW / 2}" y="${y - 3}" text-anchor="middle" class="chart-lbl zone-mid">${w.count}</text>` : ''}
      <text x="${x + barW / 2}" y="${H - 2}" text-anchor="middle" class="chart-axis">${formatMonthDay(w.start)}</text></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="sessions per week">
    <line x1="0" x2="${W}" y1="${barTop(goal)}" y2="${barTop(goal)}" class="chart-grid chart-target"/>${bars}</svg>`;
}
