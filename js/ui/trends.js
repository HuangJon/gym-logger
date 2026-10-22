/** Trends tab: pinned controls, summary, weekly bars, training calendar, target hit rate, progress per lift, and a chart per lift. */
import { SESSION_COLORS, SESSION_LABELS, SESSION_LETTERS, WEEKLY_GOAL } from '../config/program.js';
import { repRangeText } from '../core/exercises.js';
import { todayISO, addDays, isISODate, formatShort, formatMonthDay, agoText, daysBetween } from '../core/dates.js';
import { hasValue, round2, signed } from '../core/numbers.js';
import { STATUS, formatSets } from '../core/records.js';
import { repZone } from '../core/progress.js';
import { liftSeries, isWeighted, inRange, groupingFor, groupPoints, changeOverWindows, CHANGE_WINDOWS, weeklyCounts, summaryStats } from '../core/trends.js';
import { makeDemoSessions, makeDemoClimbs } from '../dev/demo.js';
import { calendarWeeks, targetHitRate, liftProgress, pickOneUsage, PROGRESS, pct, MIN_COMPARE } from '../core/insights.js';
import { esc, delegate, tipAttrs, showTip } from './dom.js';
import { lineChart, weeklyBarsChart, percentBarsChart, sparkline } from './charts.js';

const RANGE_BUTTONS = [['1m', '1M'], ['3m', '3M'], ['1y', '1Y'], ['all', 'All'], ['custom', 'Custom']];
const MODE_BUTTONS = [['weight', 'Weight×reps'], ['e1rm', 'Strength']];
const RANGE_NAMES = { '1m': 'the last month', '3m': 'the last 3 months', '1y': 'the last year', all: 'any range' };
const STALE_DAYS = 14;
const RECENT_COUNT = 6;
const SORT_KEY = 'liftlog:progressSort';
function readSort() { try { return localStorage.getItem(SORT_KEY) === 'workout' ? 'workout' : 'attention'; } catch { return 'attention'; } }

export function createTrendsView({ root, repo }) {
  const area = root.querySelector('#trends-area');
  const state = {
    range: null,        // null → pick automatically on first render
    mode: 'weight',     // 'weight' (weight line + reps labels) | 'e1rm' (estimated 1-rep max)
    custom: null,       // { from, to } for the Custom range
    demo: false,        // preview with generated sample data (never saved)
    progressSort: readSort(),   // 'attention' | 'workout' (remembered on this phone)
  };

  function render() {
    const today = todayISO();
    const sessions = state.demo ? makeDemoSessions(today) : repo.sessions;
    const climbs = state.demo ? makeDemoClimbs(today) : repo.climbs;
    if (!sessions.length) {
      area.innerHTML = demoBar(0) + '<div class="empty-state">No sessions logged yet.<br>Trends appear once you complete a workout.</div>';
      return;
    }
    // open on 3M if anything is recent, otherwise All
    if (!state.range) state.range = sessions.some(s => daysBetween(s.date, today) < 91) ? '3m' : 'all';
    const filter = inRange(state.range, today, state.custom);
    const grouping = groupingFor(state.range, state.custom);
    const rangeName = state.range === 'custom' ? `${formatShort(state.custom.from)} – ${formatShort(state.custom.to)}` : RANGE_NAMES[state.range];

    area.innerHTML = controls() + demoBar(sessions.length) + stats(sessions, today) + weeklyCard(sessions, today, climbs) +
      calendarCard(sessions, climbs, today) + hitRateCard(sessions, climbs, today) + progressCard(sessions, today) + explainer() +
      liftSeries(sessions).map(series => liftCard(series, { today, filter, grouping, rangeName })).join('');
  }

  // ── top of the tab ──────────────────────────────────────
  function segmented(current, buttons, action) {
    return `<div class="seg">${buttons.map(([value, label]) =>
      `<button type="button" data-action="${action}" data-value="${value}" aria-pressed="${current === value}">${label}</button>`).join('')}</div>`;
  }

  function controls() {
    const custom = state.range === 'custom' ? `
      <div class="tc-row tc-custom">
        <label>From <input type="date" value="${state.custom.from}" max="${state.custom.to}" data-action="custom-from"></label>
        <label>To <input type="date" value="${state.custom.to}" min="${state.custom.from}" data-action="custom-to"></label>
      </div>` : '';
    return `<div class="trend-controls" id="trend-controls">
      <div class="tc-row">${segmented(state.range, RANGE_BUTTONS, 'range')}${segmented(state.mode, MODE_BUTTONS, 'mode')}</div>${custom}</div>`;
  }

  // ── training calendar ───────────────────────────────────
  function calendarCard(sessions, climbs, today) {
    const { weeks, anchored } = calendarWeeks(sessions, climbs, today);
    const cell = day => {
      const lift = day.lifts[0], mode = lift?.mode;
      const bits = [
        ...day.lifts.map(l => `${SESSION_LABELS[l.session]}${l.mode !== 'normal' ? ` (${l.mode})` : ''}`),
        day.climb && `${day.climb} climb`,
      ].filter(Boolean);
      const cls = ['cal-day', day.future && 'future', lift && 'lift', mode && mode !== 'normal' && `m-${mode}`, day.climb && `c-${day.climb}`, day.date === today && 'today'].filter(Boolean).join(' ');
      const label = day.lifts.length === 1 ? SESSION_LETTERS[day.lifts[0].session] : day.lifts.length > 1 ? `×${day.lifts.length}` : '';
      const tip = `${formatShort(day.date)}${bits.length ? ` — ${bits.join(', ')}` : ' — rest day'}`;
      return `<span class="${cls}" title="${esc(tip)}"${day.future ? '' : tipAttrs(tip)}>${label ? `<b>${label}</b>` : ''}</span>`;
    };
    let lastMonth = '';
    const rows = weeks.map(w => {
      const month = new Date(`${w.start}T12:00:00`).toLocaleDateString('en-US', { month: 'short' });
      const label = month !== lastMonth ? (lastMonth = month) : '';
      return `<div class="cal-row"><span class="cal-month">${label}</span>${w.days.map(cell).join('')}</div>`;
    }).join('');
    return `<div class="card trend-card cal-card">
      <div class="trend-head"><span class="trend-name">Training calendar</span><span class="trend-sub">${anchored ? '12 weeks up to your last activity' : 'last 12 weeks'}</span></div>
      <div class="cal-grid"><div class="cal-row cal-head"><span class="cal-month"></span>${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<span class="cal-dow">${d}</span>`).join('')}</div>${rows}</div>
      <div class="cal-legend"><span><i class="cal-day lift"><b>A</b></i>lifted (workout A/B/C)</span><span><i class="cal-day lift"><b>×2</b></i>2 workouts that day</span>
        <span><i class="cal-day lift m-maintain"><b>B</b></i>maintain</span><span><i class="cal-day lift m-deload"><b>C</b></i>deload</span>
        <span><i class="cal-day c-easy"></i>easy climb</span><span><i class="cal-day c-hard"></i>hard climb</span></div>
      <div class="tip-hint">Tap a day for details.</div>
    </div>`;
  }

  // ── target hit rate ─────────────────────────────────────
  function hitRateCard(sessions, climbs, today) {
    const r = targetHitRate(sessions, climbs, today);
    const head = `<div class="trend-head"><span class="trend-name">Target hit rate</span><span class="trend-sub">lifts that hit their target · normal sessions${r.anchored ? ' · up to your last session' : ''}</span></div>`;
    if (!r.total) return `<div class="card trend-card">${head}<div class="trend-empty">Fills in as you log sessions — your older logs don't have targets.</div></div>`;
    const recent = pct(r.recent);
    const compare = r.afterHard.total >= MIN_COMPARE && r.otherDays.total >= MIN_COMPARE
      ? `<div class="hr-compare"><span>Day after a hard climb: <b>${pct(r.afterHard)}%</b> <i>(${r.afterHard.total} lifts)</i></span><span>Other days: <b>${pct(r.otherDays)}%</b> <i>(${r.otherDays.total} lifts)</i></span>
         ${pct(r.otherDays) - pct(r.afterHard) >= 15 ? '<span class="hr-note">Hard climbing is costing you on lifting days — consider Maintain or ↓ Deload on pulling lifts the day after.</span>' : ''}</div>`
      : `<div class="hr-compare muted">Climbing comparison appears once there are ${MIN_COMPARE}+ lifts on days after a hard climb (now ${r.afterHard.total}).</div>`;
    return `<div class="card trend-card">${head}
      <div class="hr-big"><b class="${recent >= 75 ? 'zone-top' : recent >= 50 ? 'zone-mid' : 'zone-low'}">${recent ?? '–'}${recent === null ? '' : '%'}</b> <span>last 4 weeks${r.recent.total ? ` · ${r.recent.hit} of ${r.recent.total}` : ''}</span></div>
      ${percentBarsChart(r.weeks, { title: 'target hit rate per week' })}<div class="tip-hint">Tap a bar for details.</div>
      ${compare}
      <div class="hr-hint">Mostly 70–90% is healthy progress. A steady drop is an early sign of fatigue — before lifts stall.</div>
    </div>`;
  }

  // ── progress per lift ───────────────────────────────────
  const STATUS_LABEL = { progressing: 'progressing', holding: 'holding', stalled: 'stalled', idle: 'not done lately', new: 'just started', top: 'top of range' };
  const fmtNum = v => String(round2(v));
  const monthDay = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });   // "Apr 19"
  function progressRow(l, today) {
    const u = l.unit;
    const trend = l.trend
      ? (l.trend.metric === 'e1rm'
        ? `<span class="pg-trend ${l.trend.pct > 0 ? 'up' : l.trend.pct < 0 ? 'down' : ''}"${tipAttrs(`Estimated 1-rep max went from ${fmtNum(l.trend.from)} to ${fmtNum(l.trend.to)} ${u} since ${formatShort(l.trend.since)}. It combines weight and reps (weight × (1 + reps/30)), so more reps at the same weight counts too.`)}>${l.trend.pct > 0 ? '+' : ''}${l.trend.pct}% in ${l.trend.weeks} wk${l.trend.weeks === 1 ? '' : 's'}</span>`
        : `<span class="pg-trend ${l.trend.delta > 0 ? 'up' : l.trend.delta < 0 ? 'down' : ''}">${signed(l.trend.delta)} rep${Math.abs(l.trend.delta) === 1 ? '' : 's'} in ${l.trend.weeks} wk${l.trend.weeks === 1 ? '' : 's'}</span>`)
      : '';
    const strength = l.strength === null ? '' : l.weighted
      ? `<span class="pg-est"${tipAttrs('Estimated 1-rep max from your best set last time — a single number that goes up whether you add weight or reps. You never need to test it.')}>est. max <b>${fmtNum(l.strength)} ${esc(u)}</b></span>`
      : `<span class="pg-est">last <b>${l.strength} reps</b></span>`;
    const startNow = l.startNow && l.startNow.from !== l.startNow.to
      ? `${fmtNum(l.startNow.from)} → <b>${fmtNum(l.startNow.to)}</b> ${l.weighted ? esc(u) : 'reps'} since ${monthDay(l.startNow.since)}`
      : l.startNow ? `same ${l.weighted ? 'weight' : 'reps'} since ${monthDay(l.startNow.since)}` : '';
    const best = l.best ? (l.weighted && hasValue(l.best.weight) ? `${l.best.weight} ${u} × ${l.best.reps}` : `${l.best.reps} reps`) : '';
    const moved = l.status === 'idle' ? `last done ${agoText(l.lastDate, today)}`
      : l.lastProgress ? `last up ${agoText(l.lastProgress, today)}` : (l.sessions > 1 ? 'no progress yet' : '');
    const extra = l.status === 'stalled' ? `${l.sinceProgress} sessions without progress` : l.status === 'top' ? 'try a harder variation' : '';
    const letters = l.workouts.map(n => SESSION_LETTERS[n]).join(' · ');
    const detail = [startNow, best && `best <b>${esc(best)}</b>`, esc(moved), esc(extra)].filter(Boolean).join(' · ');
    return `<div class="pg-row">
        <span class="pg-name">${esc(l.name)}</span>${letters ? `<span class="pg-letters">${letters}</span>` : ''}<span class="pg-status s-${l.status}">${STATUS_LABEL[l.status]}</span>
        <span class="pg-line"><span class="pg-spark s-${l.status}">${sparkline(l.spark)}</span>${strength}${trend}</span>
        ${detail ? `<span class="pg-detail">${detail}</span>` : ''}
      </div>`;
  }

  function progressCard(sessions, today) {
    const { lifts, recentPrs } = liftProgress(sessions, today);
    if (!lifts.length) return '';
    const prs = recentPrs.length
      ? `<ul>${recentPrs.slice(0, 6).map(p => `<li><b>${esc(p.name)}</b> · ${esc(p.text)} <span class="trend-ago">${esc(formatShort(p.date))}</span></li>`).join('')}</ul>`
      : `<div class="pg-none">None in the last ${PROGRESS.prRecentDays / 7} weeks.</div>`;
    let list;
    if (state.progressSort === 'workout') {
      list = Object.keys(SESSION_LABELS).map(Number).map(n => {
        const here = lifts.filter(l => l.workouts[0] === n);
        return here.length ? `<div class="pg-group">${esc(SESSION_LABELS[n])}</div>${here.map(l => progressRow(l, today)).join('')}` : '';
      }).join('') + (lifts.some(l => !l.workouts.length) ? lifts.filter(l => !l.workouts.length).map(l => progressRow(l, today)).join('') : '');
    } else {
      list = lifts.map(l => progressRow(l, today)).join('');
    }
    const abs = pickOneUsage(sessions, 'core');
    const absLine = abs ? `<div class="pg-abs"><span class="pg-sub">${esc(SESSION_LABELS[abs.session])} abs · last ${abs.total}</span>
      ${abs.names.map(n => `${esc(n)} <b>${abs.counts[n]}</b>`).join(' · ')} · both <b>${abs.both}</b></div>` : '';
    return `<div class="card trend-card">
      <div class="trend-head"><span class="trend-name">Progress per lift</span><span class="trend-sub">deloads left out · maintain days don't count against you</span></div>
      <div class="pg-prs"><div class="pg-sub">PRs · last ${PROGRESS.prRecentDays / 7} weeks</div>${prs}</div>
      <div class="pg-sort">${segmented(state.progressSort, [['attention', 'Needs attention'], ['workout', 'By workout']], 'progress-sort')}</div>
      <div class="pg-list">${list}</div>
      ${absLine}
    </div>`;
  }

  function demoBar(count) {
    return state.demo
      ? '<div class="demo-bar is-demo"><span>Sample data — generated for preview, nothing is saved.</span><button type="button" class="btn-small" data-action="demo">Back to my data</button></div>'
      : (count < 10 ? '<div class="demo-bar"><span>Want to see what this looks like with a few weeks of logs?</span><button type="button" class="btn-small" data-action="demo">Preview with sample data</button></div>' : '');
  }

  function stats(sessions, today) {
    const s = summaryStats(sessions, today);
    const tile = (num, label) => `<div class="card trend-stat"><div class="ts-num">${num}</div><div class="ts-lbl">${label}</div></div>`;
    return `<div class="trend-stats">${tile(s.total, 'sessions logged')}${tile(s.perWeek.toFixed(1), 'per week (last 4 wks)')}${tile(agoText(s.lastDate, today), 'last session')}</div>`;
  }

  function weeklyCard(sessions, today, climbs) {
    const { weeks, anchored } = weeklyCounts(sessions, today, 8, climbs);
    const anyClimbs = weeks.some(w => w.climbs);
    return `<div class="card trend-card">
      <div class="trend-head"><span class="trend-name">Sessions per week</span>
        <span class="trend-sub">${anchored ? '8 weeks up to your last session · ' : ''}dashed line = ${WEEKLY_GOAL}/week goal${anyClimbs ? ' · <span class="climb-key">▲ climbing days</span> (green = easy, orange = any hard)' : ''}</span></div>
      ${weeklyBarsChart(weeks, WEEKLY_GOAL)}<div class="tip-hint">Tap a bar for details.</div></div>`;
  }

  function explainer() {
    if (state.mode === 'e1rm') {
      return '<div class="trend-explain"><b>Strength</b> = estimated 1-rep max, weight × (1 + reps ÷ 30). A single number that goes up when you add reps <i>or</i> weight — useful for comparing across rep ranges, but it’s an estimate, not a lift you did. Hollow dot = partial.</div>';
    }
    return `<div class="trend-explain">The line is your working weight; the number on each dot is the reps you hit.
      <span class="zone-legend"><span class="zone-top">● top of range: add weight</span><span class="zone-mid">● in range: keep going</span><span class="zone-low">● below range</span><span>○ partial</span><span class="zone-deload">○ deload</span><span class="zone-maintain">○ maintain</span></span></div>`;
  }

  // ── one card per lift ───────────────────────────────────
  function liftCard(series, { today, filter, grouping, rangeName }) {
    const tags = series.retired ? '<span class="pill-muted">old program</span>'
      : [...series.sessions].sort().map(n => `<span class="trend-sess" style="color:${SESSION_COLORS[n]}">${SESSION_LETTERS[n]}</span>`).join('');
    const head = `<div class="trend-head"><span class="trend-name">${esc(series.name)}</span>${tags}</div>`;
    const last = series.points[series.points.length - 1];
    if (!last) return `<div class="card trend-card empty">${head}<div class="trend-empty">Not logged yet</div></div>`;

    const weighted = isWeighted(series);
    const unit = last.unit || series.unit;
    return `<div class="card trend-card">${head}
      ${meta(series, last, weighted, unit, today)}
      ${changeTable(series.points, weighted, unit, today)}
      ${chart(series, weighted, unit, filter, grouping, rangeName)}
      ${recentStrip(series, weighted)}
    </div>`;
  }

  function meta(series, last, weighted, unit, today) {
    const best = key => { const v = series.points.filter(p => hasValue(p[key])).map(p => Number(p[key])); return v.length ? Math.max(...v) : null; };
    const lastText = [weighted && hasValue(last.weight) && `${last.weight} ${unit}`, hasValue(last.reps) && `${last.reps} reps`].filter(Boolean).join(' × ');
    const n = series.points.length, logs = `${n} log${n === 1 ? '' : 's'}`;
    const bestText = weighted
      ? `Best: <b>${best('weight')} ${unit}</b>${state.mode === 'e1rm' && best('e1rm') !== null ? ` · est. 1RM <b>${best('e1rm')}</b>` : ''} · ${logs}`
      : `Best: <b>${best('reps')} reps</b> · ${logs}`;
    const stale = daysBetween(last.date, today) > STALE_DAYS;
    return `<div class="trend-meta">
      <span>Last: <b>${lastText}</b> · ${formatShort(last.date)} <span class="${stale ? 'trend-stale' : 'trend-ago'}">(${agoText(last.date, today)})</span></span>
      <span>${bestText}</span></div>`;
  }

  function changeTable(points, weighted, unit, today) {
    const change = changeOverWindows(points, weighted, today);
    if (!change) return '';
    const cells = change.cells.map(c => {
      if (!c) return '<span class="dt-v">—</span>';
      const dir = c.delta > 0 ? ' up' : c.delta < 0 ? ' down' : '';
      return `<span class="dt-v${dir}" title="vs ${formatShort(c.vsDate)}"${tipAttrs(`${signed(c.delta)}${weighted ? ` ${unit}` : ''} compared with ${formatShort(c.vsDate)}${c.short ? ' (not much data that far back)' : ''}`)}>${signed(c.delta)}${weighted ? ` ${unit}` : ''}${c.short ? '<sup>*</sup>' : ''}</span>`;
    }).join('');
    return `<div class="dtable"><span></span>${CHANGE_WINDOWS.map(([label]) => `<span class="dt-h">${label}</span>`).join('')}
      <span class="dt-lbl">${weighted ? 'Weight' : 'Reps'}</span>${cells}</div>
      ${change.anyShort ? `<div class="dt-foot">* less history than that window, so compared with your first log (${formatShort(change.firstDate)})</div>` : ''}`;
  }

  function chart(series, weighted, unit, filter, grouping, rangeName) {
    const shown = series.points.filter(filter);
    if (!shown.length) return `<div class="trend-empty">No logs in ${rangeName}.</div>`;
    const mode = !weighted ? 'reps' : state.mode;
    const { points, by } = groupPoints(shown, mode, grouping);
    const target = series.reps ? ` · target ${repRangeText(series.reps)}` : '';
    const tip = p => `${formatShort(p.date)}: ${p.sets?.length ? formatSets(p.sets, weighted ? (p.unit || unit) : '') : [hasValue(p.weight) && `${p.weight} ${p.unit || unit}`, hasValue(p.reps) && `${p.reps} reps`].filter(Boolean).join(' × ')}` +
      `${mode === 'e1rm' && p.e1rm ? ` → est. 1RM ${p.e1rm}` : ''}${p.status === STATUS.PARTIAL ? ' (partial)' : ''}${p.deload ? ' (deload)' : ''}${p.maintain ? ' (maintain)' : ''}${p.n > 1 ? ` — best of ${p.n} sessions, ${p.bucketLabel}` : ''}`;
    const zone = p => repZone(p.reps, series.reps);

    let legend, svg;
    if (mode === 'reps') {
      legend = `<span class="chart-key"><i></i>Reps${target}</span>`;
      svg = lineChart(points, { valueOf: p => p.reps, labelOf: p => p.reps, zoneOf: zone, tipOf: tip, band: series.reps });
    } else if (mode === 'e1rm') {
      legend = `<span class="chart-key"><i></i>Est. 1RM (${unit})</span>`;
      svg = lineChart(points, { valueOf: p => p.e1rm, labelOf: p => p.e1rm, zoneOf: () => 'mid', tipOf: tip, minSpan: 10 });
    } else {
      legend = `<span class="chart-key"><i></i>Weight (${unit})</span><span class="chart-key-note">numbers = reps${target}</span>`;
      svg = lineChart(points, { valueOf: p => p.weight, labelOf: p => p.reps, zoneOf: zone, tipOf: tip, grid: 'levels', tagChanges: true, minSpan: 5 });
    }
    const note = by ? `<div class="group-note">Each dot = best set of the ${by}. Tap a dot for details.</div>` : '<div class="tip-hint">Tap a dot for details.</div>';
    return `<div class="chart-legend">${legend}</div>${svg}${note}`;
  }

  function recentStrip(series, weighted) {
    const recent = series.points.filter(p => (weighted ? hasValue(p.weight) : hasValue(p.reps))).slice(-RECENT_COUNT);
    if (!recent.length) return '';
    return `<div class="recent"><span class="recent-lbl">Recent →</span>${recent.map((p, i) => {
      const value = weighted ? `${round2(p.weight)}${hasValue(p.reps) ? `×${p.reps}` : ''}` : `${p.reps} reps`;
      const cls = ['rc', `zone-${repZone(p.reps, series.reps)}`, p.status === STATUS.PARTIAL && 'partial', p.deload && 'deload', p.maintain && 'maintain', i === recent.length - 1 && 'latest'].filter(Boolean).join(' ');
      const tip = `${formatShort(p.date)}: ${p.sets?.length ? formatSets(p.sets, weighted ? (p.unit || series.unit) : '') : value}${p.status === STATUS.PARTIAL ? ' (partial)' : ''}${p.deload ? ' (deload)' : ''}${p.maintain ? ' (maintain)' : ''}`;
      return `<span class="${cls}" title="${esc(tip)}"${tipAttrs(tip)}><i>${formatMonthDay(p.date)}</i>${value}</span>`;
    }).join('')}</div>`;
  }

  // ── actions ─────────────────────────────────────────────
  function setRange(value) {
    if (value === 'custom' && !state.custom) state.custom = { from: addDays(todayISO(), -90), to: todayISO() };
    state.range = value;
    render();
  }

  function setCustom(which, value) {
    if (isISODate(value)) {
      state.custom[which] = value;
      if (state.custom.from > state.custom.to) state.custom = { from: state.custom.to, to: state.custom.from };
    }
    render();
  }

  delegate(root, 'click', {
    'range': el => setRange(el.dataset.value),
    'mode': el => { state.mode = el.dataset.value; render(); },
    'progress-sort': el => { state.progressSort = el.dataset.value; try { localStorage.setItem(SORT_KEY, state.progressSort); } catch { /* not saved — fine */ } render(); },
    'demo': () => { state.demo = !state.demo; render(); },
    'tip': el => showTip(el, '.trend-card'),
  });
  delegate(root, 'keydown', { 'tip': (el, e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showTip(el, '.trend-card'); } } });
  delegate(root, 'change', {
    'custom-from': el => setCustom('from', el.value),
    'custom-to': el => setCustom('to', el.value),
  });

  return { render };
}
