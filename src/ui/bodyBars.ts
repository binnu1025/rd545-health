import { judge, type Range } from '../health/standards';

export interface BarItem {
  label: string; unit: string; value: number | null; digits: number;
  range?: Range | null;
  /** Fixed axis for scales without a natural zero (e.g. muscle score −4…+4). */
  axis?: [number, number];
  /** Reference point drawn on the bar without a normal band (e.g. actual age for metabolic age). */
  marker?: { value: number; label: string; describe: (diff: number) => string };
  note?: string;
}

const fmt = (v: number, digits: number) => v.toFixed(digits);

function axisFor(item: BarItem, value: number): [number, number] {
  if (item.axis) return item.axis;
  const { range, marker } = item;
  let min: number, max: number;
  if (range) { const span = range.high - range.low; min = Math.max(0, range.low - span * 0.7); max = range.high + span * 1.3; }
  else { const ref = Math.max(value, marker?.value ?? 0); min = 0; max = ref * 1.35 || 1; }
  // Keep the value visibly inside the track.
  if (value > max) max = value + (max - min) * 0.12;
  if (value < min) min = Math.max(0, value - (max - min) * 0.12);
  return [min, max];
}

function row(item: BarItem): string {
  if (item.value === null) return `<div class="bar-row"><div class="bar-label">${item.label}<small>${item.unit}</small></div><div class="bar-track empty"></div><div class="bar-result">—<small>無資料</small></div></div>`;
  const value = item.value, [min, max] = axisFor(item, value), pos = (v: number) => Math.min(100, Math.max(0, (v - min) / (max - min) * 100));
  // On a signed scale (e.g. −4…+4) the bar grows from zero, not from the axis minimum.
  const zero = min < 0 && max > 0 ? pos(0) : 0, fillFrom = Math.min(zero, pos(value));
  let zones = '', ticks = '', state = 'plain', verdict = item.note ?? '無公開標準', gap = '';
  if (item.range) {
    const r = item.range, a = pos(r.low), b = pos(r.high), j = judge(value, r);
    zones = `<i class="zone low" style="width:${a}%"></i><i class="zone normal" style="left:${a}%;width:${b - a}%"></i><i class="zone high" style="left:${b}%;width:${100 - b}%"></i>`;
    ticks = `<span class="tick" style="left:${a}%">${fmt(r.low, item.digits)}</span><span class="tick" style="left:${b}%">${fmt(r.high, item.digits)}</span>`;
    state = j;
    verdict = r.labels[j === 'low' ? 0 : j === 'normal' ? 1 : 2] || (j === 'low' ? '偏低' : '偏高');
    gap = j === 'normal' ? '在正常範圍內' : j === 'high' ? `超出正常上限 ${fmt(value - r.high, item.digits)} ${item.unit}` : `距正常下限還差 ${fmt(r.low - value, item.digits)} ${item.unit}`;
  } else if (item.marker) {
    const m = item.marker, diff = value - m.value;
    ticks = `<span class="tick marker" style="left:${pos(m.value)}%">${m.label}</span>`;
    zones = `<i class="marker-line" style="left:${pos(m.value)}%"></i>`;
    state = diff > 0 ? 'high' : 'normal'; verdict = m.describe(diff); gap = '';
  }
  return `<div class="bar-row ${state}"><div class="bar-label">${item.label}<small>${item.unit}</small></div>
    <div class="bar-track">${zones}${zero ? `<i class="marker-line zero" style="left:${zero}%"></i><span class="tick" style="left:${zero}%">0</span>` : ''}<b class="bar-fill" style="left:${fillFrom}%;width:${Math.abs(pos(value) - zero)}%"></b>${ticks}</div>
    <div class="bar-result"><strong>${fmt(value, item.digits)}</strong><span class="verdict">${verdict}</span>${gap ? `<small>${gap}</small>` : ''}</div></div>`;
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
