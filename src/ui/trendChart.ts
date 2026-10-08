import { bmiRange, bodyFatRange, bodyWaterRange, muscleQualityRange, visceralFatRange, weightRange, type Range, type Sex } from '../health/standards';
import type { Person, SheetRecord } from '../storage/sheetClient';

interface Metric { key: string; label: string; unit: string; digits: number; range?: (p: { sex: Sex; age: number; heightCm: number }) => Range | null }
const metrics: Metric[] = [
  { key: '體重kg', label: '體重', unit: 'kg', digits: 1, range: p => weightRange(p.heightCm) },
  { key: '體脂率%', label: '體脂率', unit: '%', digits: 1, range: p => bodyFatRange(p.sex) },
  { key: '肌肉量kg', label: '肌肉量', unit: 'kg', digits: 1 },
  { key: 'BMI', label: 'BMI', unit: '', digits: 1, range: () => bmiRange() },
  { key: '內臟脂肪', label: '內臟脂肪', unit: '等級', digits: 1, range: () => visceralFatRange() },
  { key: '體水分率%', label: '體水分率', unit: '%', digits: 1, range: p => bodyWaterRange(p.sex) },
  { key: '肌肉品質', label: '肌肉品質', unit: '分', digits: 0, range: p => muscleQualityRange(p.sex, p.age) },
  { key: '基礎代謝kcal', label: '基礎代謝', unit: 'kcal', digits: 0 },
  { key: '代謝年齡', label: '代謝年齡', unit: '歲', digits: 0 },
  { key: '骨量kg', label: '骨量', unit: 'kg', digits: 1 },
  ...['右手', '左手', '軀幹', '右腳', '左腳'].flatMap(part => [
    { key: `${part}肌肉kg`, label: `${part}肌肉`, unit: 'kg', digits: 2 },
    { key: `${part}體脂%`, label: `${part}體脂`, unit: '%', digits: 1 },
  ]),
];
let chosen = metrics[0].key;

const W = 720, H = 260, M = { top: 16, right: 64, bottom: 30, left: 48 };
const svgNs = 'http://www.w3.org/2000/svg';
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
  const node = document.createElementNS(svgNs, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v)); return node;
};
const taipeiDate = (d: Date, withYear = false) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return withYear ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` : `${p.month}/${p.day}`;
};
function niceTicks(min: number, max: number, count = 5) {
  const step0 = (max - min) / count, mag = 10 ** Math.floor(Math.log10(step0)), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0)!;
  const ticks: number[] = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}
function ageOn(birth: string, at: Date) {
  const [y, m, d] = birth.split('-').map(Number); if (!y) return null;
  const t = new Date(at.getTime() + 8 * 3600000); let age = t.getUTCFullYear() - y;
  if (t.getUTCMonth() + 1 < m || (t.getUTCMonth() + 1 === m && t.getUTCDate() < d)) age--; return age;
}
const signed = (v: number, digits: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}`;

export function renderTrend(all: SheetRecord[], person: Person): HTMLElement {
  const root = document.createElement('div');
  root.className = 'trend';
  const rows = all.filter(r => r['人員id'] === person.id && r['量測時間'])
    .map(r => ({ at: new Date(String(r['量測時間'])), r })).filter(x => !isNaN(+x.at)).sort((a, b) => +a.at - +b.at);
  const title = document.createElement('h3'); title.textContent = `${person.姓名} 的變化趨勢`;
  root.append(title);
  if (!rows.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = '試算表裡還沒有這個人的紀錄。讀取一次結果後就會出現。'; root.append(p); return root; }

  // Filters in one row above the chart.
  const chips = document.createElement('div'); chips.className = 'chips'; chips.setAttribute('role', 'tablist');
  const body = document.createElement('div');
  for (const m of metrics) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = m.label; b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(m.key === chosen));
    b.onclick = () => { chosen = m.key; chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-selected', String(c === b))); draw(); };
    chips.append(b);
  }
  root.append(chips, body);

  function draw() {
    const metric = metrics.find(m => m.key === chosen)!;
    const points = rows.map(x => ({ at: x.at, v: x.r[metric.key] })).filter((p): p is { at: Date; v: number } => typeof p.v === 'number' && isFinite(p.v));
    body.replaceChildren();
    if (!points.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = '這個項目還沒有數據。'; body.append(p); return; }
    const last = points[points.length - 1], age = ageOn(person.出生日期, last.at), height = Number(person.身高cm);
    const range = metric.range && age !== null && height ? metric.range({ sex: person.性別, age, heightCm: height }) : null;

    // Headline figures: latest, change since previous, change since first.
    const stats = document.createElement('div'); stats.className = 'trend-stats';
    const stat = (label: string, value: string, sub = '') => { const d = document.createElement('div'); const s = document.createElement('small'); s.textContent = label; const b = document.createElement('strong'); b.textContent = value; d.append(s, b); if (sub) { const t = document.createElement('span'); t.textContent = sub; d.append(t); } stats.append(d); };
    stat('最新', `${last.v.toFixed(metric.digits)} ${metric.unit}`, taipeiDate(last.at, true));
    if (points.length > 1) {
      stat('與上次相比', `${signed(last.v - points[points.length - 2].v, metric.digits)} ${metric.unit}`);
      stat(`與第一次相比（${taipeiDate(points[0].at)}）`, `${signed(last.v - points[0].v, metric.digits)} ${metric.unit}`);
    }
    if (range) stat('正常範圍', `${range.low}–${range.high} ${metric.unit}`, range.source);
    body.append(stats);

    // Scales: time on x (real gaps between measurements), value on y including the normal band.
    const t0 = +points[0].at, t1 = +last.at, span = t1 - t0 || 86400000;
    const xs = (t: number) => points.length === 1 ? (M.left + W - M.right) / 2 : M.left + (t - t0) / span * (W - M.left - M.right);
    const values = points.map(p => p.v).concat(range ? [range.low, range.high] : []);
    let lo = Math.min(...values), hi = Math.max(...values); const pad = (hi - lo || Math.abs(hi) * 0.1 || 1) * 0.15; lo -= pad; hi += pad;
    const ticks = niceTicks(lo, hi); lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const ys = (v: number) => M.top + (hi - v) / (hi - lo) * (H - M.top - M.bottom);

    const wrap = document.createElement('div'); wrap.className = 'trend-chart';
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${person.姓名} ${metric.label} 折線圖，共 ${points.length} 筆` });
    for (const t of ticks) {
      svg.append(el('line', { x1: M.left, x2: W - M.right, y1: ys(t), y2: ys(t), class: 'grid' }));
      const label = el('text', { x: M.left - 8, y: ys(t) + 4, 'text-anchor': 'end', class: 'axis' }); label.textContent = String(t); svg.append(label);
    }
    if (range) {
      const top = ys(Math.min(range.high, hi)), bottom = ys(Math.max(range.low, lo));
      svg.append(el('rect', { x: M.left, y: top, width: W - M.left - M.right, height: Math.max(0, bottom - top), class: 'normal-band' }));
      const tag = el('text', { x: W - M.right + 6, y: top + 12, class: 'axis band-label' }); tag.textContent = '正常範圍'; svg.append(tag);
    }
    // X labels: first, last, and a few in between that do not collide.
    const xLabels: number[] = []; points.forEach((p, i) => { const x = xs(+p.at); if (i === 0 || i === points.length - 1 || xLabels.every(o => Math.abs(o - x) > 60)) xLabels.push(x); });
    points.forEach(p => { const x = xs(+p.at); if (!xLabels.includes(x)) return; const t = el('text', { x, y: H - 8, 'text-anchor': 'middle', class: 'axis' }); t.textContent = taipeiDate(p.at); svg.append(t); });
    if (points.length > 1) svg.append(el('path', { d: points.map((p, i) => `${i ? 'L' : 'M'}${xs(+p.at).toFixed(1)},${ys(p.v).toFixed(1)}`).join(''), class: 'line' }));
    for (const p of points) svg.append(el('circle', { cx: xs(+p.at), cy: ys(p.v), r: 4, class: 'dot' }));
    // Value at the end of the line.
    const endLabel = el('text', { x: xs(t1) + 8, y: ys(last.v) + 4, class: 'end-label' }); endLabel.textContent = last.v.toFixed(metric.digits); svg.append(endLabel);

    // Crosshair snaps to the nearest measurement; same readout on keyboard focus.
    const cross = el('line', { y1: M.top, y2: H - M.bottom, class: 'crosshair', visibility: 'hidden' });
    const focus = el('circle', { r: 6, class: 'dot focus', visibility: 'hidden' });
    svg.append(cross, focus);
    const tip = document.createElement('div'); tip.className = 'trend-tip'; tip.hidden = true;
    const show = (i: number) => {
      const p = points[i], x = xs(+p.at), y = ys(p.v);
      for (const n of [cross]) { n.setAttribute('x1', String(x)); n.setAttribute('x2', String(x)); n.setAttribute('visibility', 'visible'); }
      focus.setAttribute('cx', String(x)); focus.setAttribute('cy', String(y)); focus.setAttribute('visibility', 'visible');
      const strong = document.createElement('strong'); strong.textContent = `${p.v.toFixed(metric.digits)} ${metric.unit}`;
      const when = document.createElement('span'); when.textContent = taipeiDate(p.at, true);
      const parts: Node[] = [strong, when];
      if (i > 0) { const d = document.createElement('span'); d.textContent = `比前次 ${signed(p.v - points[i - 1].v, metric.digits)}`; parts.push(d); }
      tip.replaceChildren(...parts); tip.hidden = false;
      tip.style.left = `${x / W * 100}%`; tip.style.top = `${y / H * 100}%`; current = i;
    };
    const hide = () => { cross.setAttribute('visibility', 'hidden'); focus.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    let current = points.length - 1;
    const hit = el('rect', { x: M.left - 20, y: 0, width: W - M.left - M.right + 40, height: H, class: 'hit' });
    hit.addEventListener('pointermove', e => {
      const box = svg.getBoundingClientRect(), x = (e.clientX - box.left) / box.width * W;
      let best = 0; points.forEach((p, i) => { if (Math.abs(xs(+p.at) - x) < Math.abs(xs(+points[best].at) - x)) best = i; }); show(best);
    });
    hit.addEventListener('pointerleave', hide);
    svg.append(hit);
    svg.setAttribute('tabindex', '0');
    svg.addEventListener('focus', () => show(current));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); show(Math.min(points.length - 1, Math.max(0, current + (e.key === 'ArrowRight' ? 1 : -1)))); } });
    wrap.append(svg, tip);
    body.append(wrap);
    if (points.length === 1) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = '目前只有一筆，下次量測後就能看到變化。'; body.append(p); }

    // Table view: every value reachable without hovering.
    const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '以表格檢視'; details.append(summary);
    const table = document.createElement('table'); table.className = 'segments';
    const head = table.createTHead().insertRow(); for (const h of ['量測時間', `${metric.label}（${metric.unit || '值'}）`, '與前次相比']) { const th = document.createElement('th'); th.textContent = h; head.append(th); }
    const tbody = table.createTBody();
    [...points].reverse().forEach((p, i, arr) => { const row = tbody.insertRow(); row.insertCell().textContent = taipeiDate(p.at, true); row.insertCell().textContent = p.v.toFixed(metric.digits); row.insertCell().textContent = i < arr.length - 1 ? signed(p.v - arr[i + 1].v, metric.digits) : '—'; });
    details.append(table); body.append(details);
  }
  draw();
  return root;
}
