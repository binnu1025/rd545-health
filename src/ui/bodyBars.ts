import { judge, type Range } from '../health/standards';

export interface BarItem {
  label: string; unit: string; value: number | null; digits: number;
  range?: Range | null;
  /** Fixed axis for scales without a natural zero (e.g. muscle score −4…+4). */
  axis?: [number, number];
  /** Reference point drawn on the bar without a normal band (e.g. actual age for metabolic age). */
  marker?: { value: number; label: string; describe: (diff: number) => string };
  note?: string;
  /** Same value at the previous measurement, for a "比上次" change. */
  previous?: number | null;
  /** The person's own goal for this value (weight, body fat). */
  goal?: number | null;
}

/** Everything needed to draw one bar, in percent of the track width; shared by the page and the JPG report. */
export interface BarModel {
  item: BarItem; value: number;
  zones: { low: number; high: number } | null;
  ticks: { at: number; label: string; strong?: boolean }[];
  markerAt: number | null; zeroAt: number | null;
  fillFrom: number; fillWidth: number;
  state: 'low' | 'normal' | 'high' | 'plain';
  verdict: string; gap: string;
  /** "比上次 ▼0.8 kg" or '' when there is no previous value. */
  change: string;
  goalAt: number | null; goalText: string;
}

export const fmt = (v: number, digits: number) => v.toFixed(digits);

function axisFor(item: BarItem, value: number): [number, number] {
  if (item.axis) return item.axis;
  const { range, marker } = item;
  let min: number, max: number;
  if (range) { const span = range.high - range.low; min = Math.max(0, range.low - span * 0.7); max = range.high + span * 1.3; }
  else { const ref = Math.max(value, marker?.value ?? 0, item.goal ?? 0); min = 0; max = ref * 1.35 || 1; }
  // Keep the goal on the track too.
  if (item.goal != null) { if (item.goal > max) max = item.goal + (max - min) * 0.12; if (item.goal < min) min = Math.max(0, item.goal - (max - min) * 0.12); }
  // Keep the value visibly inside the track.
  if (value > max) max = value + (max - min) * 0.12;
  if (value < min) min = Math.max(0, value - (max - min) * 0.12);
  return [min, max];
}

export function barModel(item: BarItem): BarModel | null {
  if (item.value === null) return null;
  const value = item.value, [min, max] = axisFor(item, value), pos = (v: number) => Math.min(100, Math.max(0, (v - min) / (max - min) * 100));
  // On a signed scale (e.g. −4…+4) the bar grows from zero, not from the axis minimum.
  const zero = min < 0 && max > 0 ? pos(0) : 0;
  const model: BarModel = { item, value, zones: null, ticks: [], markerAt: null, zeroAt: zero || null,
    fillFrom: Math.min(zero, pos(value)), fillWidth: Math.abs(pos(value) - zero), state: 'plain', verdict: item.note ?? '無公開標準', gap: '',
    change: changeText(item, value), goalAt: null, goalText: '' };
  if (item.goal != null) {
    model.goalAt = pos(item.goal);
    const d = value - item.goal;
    model.goalText = Math.abs(d) < 10 ** -item.digits / 2 ? '已達成目標' : `距目標 ${d > 0 ? '−' : '+'}${fmt(Math.abs(d), item.digits)} ${item.unit}`;
  }
  if (zero) model.ticks.push({ at: zero, label: '0' });
  if (item.range) {
    const r = item.range, j = judge(value, r);
    model.zones = { low: pos(r.low), high: pos(r.high) };
    model.ticks.push({ at: model.zones.low, label: fmt(r.low, item.digits) }, { at: model.zones.high, label: fmt(r.high, item.digits) });
    model.state = j;
    model.verdict = r.labels[j === 'low' ? 0 : j === 'normal' ? 1 : 2] || (j === 'low' ? '偏低' : '偏高');
    model.gap = j === 'normal' ? '在正常範圍內' : j === 'high' ? `超出正常上限 ${fmt(value - r.high, item.digits)} ${item.unit}` : `距正常下限還差 ${fmt(r.low - value, item.digits)} ${item.unit}`;
  } else if (item.marker) {
    const m = item.marker, diff = value - m.value;
    model.markerAt = pos(m.value);
    model.ticks.push({ at: model.markerAt, label: m.label, strong: true });
    model.state = diff > 0 ? 'high' : 'normal'; model.verdict = m.describe(diff);
  }
  return model;
}

/** Direction and size of the change since last time; no judgement, since down is not always better. */
function changeText(item: BarItem, value: number): string {
  if (item.previous == null) return '';
  const d = value - item.previous, step = 10 ** -item.digits;
  if (Math.abs(d) < step / 2) return '與上次相同';
  return `比上次 ${d > 0 ? '▲' : '▼'}${fmt(Math.abs(d), item.digits)} ${item.unit}`;
}

function row(item: BarItem): string {
  const m = barModel(item);
  if (!m) return `<div class="bar-row"><div class="bar-label">${item.label}<small>${item.unit}</small></div><div class="bar-track empty"></div><div class="bar-result">—<small>無資料</small></div></div>`;
  const zones = m.zones ? `<i class="zone low" style="width:${m.zones.low}%"></i><i class="zone normal" style="left:${m.zones.low}%;width:${m.zones.high - m.zones.low}%"></i><i class="zone high" style="left:${m.zones.high}%;width:${100 - m.zones.high}%"></i>` : '';
  const lines = (m.markerAt !== null ? `<i class="marker-line" style="left:${m.markerAt}%"></i>` : '') + (m.zeroAt ? `<i class="marker-line zero" style="left:${m.zeroAt}%"></i>` : '')
    + (m.goalAt !== null ? `<i class="marker-line goal" style="left:${m.goalAt}%"></i><span class="tick goal" style="left:${m.goalAt}%">目標 ${fmt(item.goal!, item.digits)}</span>` : '');
  const ticks = m.ticks.map(t => `<span class="tick${t.strong ? ' marker' : ''}" style="left:${t.at}%">${t.label}</span>`).join('');
  return `<div class="bar-row ${m.state}"><div class="bar-label">${item.label}<small>${item.unit}</small></div>
    <div class="bar-track">${zones}${lines}<b class="bar-fill" style="left:${m.fillFrom}%;width:${m.fillWidth}%"></b>${ticks}</div>
    <div class="bar-result"><strong>${fmt(m.value, item.digits)}</strong><span class="verdict">${m.verdict}</span>${m.gap ? `<small>${m.gap}</small>` : ''}${m.goalText ? `<small class="goal-text">${m.goalText}</small>` : ''}${m.change ? `<small class="delta">${m.change}</small>` : ''}</div></div>`;
}

export function renderBars(items: BarItem[]): HTMLElement {
  const root = document.createElement('div');
  root.className = 'bars';
  const sources = [...new Set(items.map(i => i.range?.source).filter(Boolean))];
  root.innerHTML = `<div class="bar-legend"><i class="low"></i>低於正常 <i class="normal"></i>正常範圍 <i class="high"></i>高於正常</div>`
    + items.map(row).join('')
    + `<p class="hint">標準出處：${sources.join('；') || '—'}。未標示範圍的項目沒有公開的台灣或 TANITA 標準，只顯示數值。</p>`;
  return root;
}
