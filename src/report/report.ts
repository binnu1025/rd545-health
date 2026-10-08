import type { BodyComposition } from '../bluetooth/bodyComposition';
import { barModel, fmt, type BarItem } from '../ui/bodyBars';
import { wholeBodyBars, type Goals, type ReportProfile } from '../ui/bodyFigure';
import { figureSvg } from '../ui/figure';

/** One-page, InBody-style report drawn as a single SVG, then rasterised to JPG for saving or sharing. */
export interface ReportInput {
  name: string; profile: ReportProfile | null; measuredAt: Date; detail: BodyComposition;
  history: { at: Date; weight: number | null; fat: number | null; muscle: number | null }[];
  previous?: BodyComposition | null; goals?: Goals;
}

const W = 1240, H = 1668;
const font = `'Noto Sans TC','Microsoft JhengHei','PingFang TC','Heiti TC',sans-serif`;
const ink = '#183d38', muted = '#5d7a70', line = '#dce7e1', brand = '#0b5b4b';
const stateColor = { low: '#4f7fa3', normal: '#1e7a5d', high: '#b5651d', plain: '#2f4f47' };
const pillColor = { low: ['#dde9f2', '#3b6688'], normal: ['#d6ecdf', '#1e6b52'], high: ['#f6e2cc', '#9a5418'], plain: ['#eef1f0', '#4d6560'] } as const;
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const taipei = (d: Date, withTime = true) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return withTime ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` : `${p.year}-${p.month}-${p.day}`;
};

function section(y: number, title: string) {
  return `<rect x="50" y="${y}" width="${W - 100}" height="40" rx="6" fill="#edf4ef"/><text x="68" y="${y + 27}" font-size="21" font-weight="700" fill="${brand}">${title}</text>`;
}

/** Three stacked mini line charts (weight, body fat, muscle) over the recent measurements, current one highlighted. */
function trends(input: ReportInput, x: number, y: number, w: number, h: number): string {
  const rows = input.history.filter(r => +r.at <= +input.measuredAt).slice(-12);
  const metrics = [['體重', 'kg', 'weight', '#b5651d', input.goals?.weightKg ?? null], ['體脂率', '%', 'fat', '#4f7fa3', input.goals?.bodyFatPct ?? null], ['肌肉量', 'kg', 'muscle', '#1e7a5d', null]] as const;
  let out = `<text x="${x}" y="${y + 22}" font-size="19" font-weight="700" fill="${ink}">近期趨勢</text>`
    + `<text x="${x + w}" y="${y + 22}" text-anchor="end" font-size="13" fill="${muted}">最近 ${rows.length} 次</text>`;
  const chartH = (h - 40) / 3;
  metrics.forEach(([label, unit, key, color, goal], i) => {
    const top = y + 40 + i * chartH, pts = rows.map(r => ({ at: r.at, v: r[key] })).filter((p): p is { at: Date; v: number } => p.v !== null);
    const px = { l: x + 4, r: x + w - 58, t: top + 34, b: top + chartH - 30 };
    out += `<rect x="${x}" y="${top}" width="${w}" height="${chartH - 10}" rx="8" fill="#f7faf8"/>`
      + `<text x="${x + 14}" y="${top + 24}" font-size="16" font-weight="700" fill="${ink}">${label} <tspan font-size="12" font-weight="400" fill="${muted}">${unit}</tspan></text>`;
    if (!pts.length) { out += `<text x="${x + w / 2}" y="${top + chartH / 2}" text-anchor="middle" font-size="14" fill="${muted}">無資料</text>`; return; }
    const last = pts[pts.length - 1], first = pts[0], delta = last.v - first.v;
    out += `<text x="${x + w - 14}" y="${top + 24}" text-anchor="end" font-size="13" fill="${muted}">${pts.length > 1 ? `${taipei(first.at, false).slice(5)} 起 ${delta > 0 ? '▲' : delta < 0 ? '▼' : ''}${Math.abs(delta).toFixed(1)}` : '量測兩次以上就會顯示變化'}</text>`;
    const vals = pts.map(p => p.v);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.15, 0.5); lo -= pad; hi += pad;
    const goalShown = goal !== null && goal >= lo && goal <= hi;
    const t0 = +first.at, t1 = +last.at;
    const sx = (at: Date) => t1 === t0 ? (px.l + px.r) / 2 : px.l + 8 + (+at - t0) / (t1 - t0) * (px.r - px.l - 16);
    const sy = (v: number) => px.b - (v - lo) / (hi - lo) * (px.b - px.t);
    if (goal !== null && !goalShown) out += `<text x="${x + 14}" y="${top + chartH - 14 - 18}" font-size="12" font-weight="700" fill="${brand}">目標 ${goal} ${unit}（還差 ${Math.abs(last.v - goal).toFixed(1)}）</text>`;
    if (goalShown) out += `<line x1="${px.l}" x2="${px.r}" y1="${sy(goal)}" y2="${sy(goal)}" stroke="${brand}" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${px.r + 6}" y="${sy(goal) + 4}" font-size="12" font-weight="700" fill="${brand}">目標 ${goal}</text>`;
    if (pts.length > 1) out += `<polyline points="${pts.map(p => `${sx(p.at).toFixed(1)},${sy(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>`;
    out += pts.map(p => `<circle cx="${sx(p.at)}" cy="${sy(p.v)}" r="${p === last ? 6 : 3.5}" fill="${p === last ? color : '#ffffff'}" stroke="${color}" stroke-width="2"/>`).join('')
      + `<text x="${Math.min(sx(last.at), px.r) + 10}" y="${sy(last.v) + 6}" font-size="17" font-weight="700" fill="${ink}">${last.v.toFixed(1)}</text>`
      + (pts.length > 1 ? `<text x="${px.l}" y="${top + chartH - 14}" font-size="12" fill="${muted}">${taipei(first.at, false)}</text>` : '')
      + `<text x="${px.r}" y="${top + chartH - 14}" text-anchor="end" font-size="12" fill="${muted}">${taipei(last.at, false)}</text>`;
  });
  return out;
}

/** Bar rows: label | track with zones and fill | value, verdict and distance from normal. */
function bars(items: BarItem[], y: number): { svg: string; height: number } {
  const trackX = 250, trackW = 600, rowH = 66, formulaH = 26;
  let top = y - rowH;
  const svg = items.map((item, i) => {
    top += rowH + (i > 0 && items[i - 1].formula ? formulaH : 0);
    const m = barModel(item), h = rowH + (item.formula ? formulaH : 0);
    const label = `<text x="70" y="${top + 26}" font-size="20" font-weight="700" fill="${ink}">${xml(item.label)}</text><text x="70" y="${top + 47}" font-size="14" fill="${muted}">${xml(item.unit)}</text>`;
    if (!m) return `${label}<rect x="${trackX}" y="${top + 12}" width="${trackW}" height="18" rx="3" fill="#f1f4f2"/><text x="880" y="${top + 28}" font-size="20" fill="${muted}">—</text>`;
    const px = (pct: number) => trackX + trackW * pct / 100;
    const zones = m.zones ? `<rect x="${trackX}" y="${top + 12}" width="${trackW * m.zones.low / 100}" height="18" fill="#eef1f0"/>`
      + `<rect x="${px(m.zones.low)}" y="${top + 12}" width="${trackW * (m.zones.high - m.zones.low) / 100}" height="18" fill="#cfe6da"/>`
      + `<rect x="${px(m.zones.high)}" y="${top + 12}" width="${trackW * (100 - m.zones.high) / 100}" height="18" fill="#f6e7d6"/>` : '';
    const lines = [m.markerAt, m.zeroAt].filter((v): v is number => v !== null).map(at => `<rect x="${px(at) - 1}" y="${top + 8}" width="2" height="26" fill="${ink}" opacity="0.7"/>`).join('')
      + (m.goalAt !== null ? `<rect x="${px(m.goalAt) - 1.5}" y="${top + 6}" width="3" height="30" fill="${brand}"/><text x="${px(m.goalAt)}" y="${top + 2}" text-anchor="middle" font-size="13" font-weight="700" fill="${brand}">目標 ${fmt(item.goal!, item.digits)}</text>` : '');
    const ticks = m.ticks.map(t => `<text x="${px(t.at)}" y="${top + 50}" text-anchor="middle" font-size="13" fill="${t.strong ? ink : muted}" font-weight="${t.strong ? 700 : 400}">${xml(t.label)}</text>`).join('');
    const fill = `<rect x="${px(m.fillFrom)}" y="${top + 17}" width="${Math.max(3, trackW * m.fillWidth / 100)}" height="8" rx="4" fill="${stateColor[m.state]}"/>`;
    const [pillBg, pillInk] = pillColor[m.state], small = m.verdict.length > 8, verdictW = 22 + m.verdict.length * (small ? 12.5 : 15);
    const result = `<text x="880" y="${top + 30}" font-size="26" font-weight="700" fill="${ink}">${fmt(m.value, item.digits)}</text>`
      + `<rect x="${980}" y="${top + 9}" width="${verdictW}" height="26" rx="13" fill="${pillBg}"/><text x="${980 + verdictW / 2}" y="${top + 27}" text-anchor="middle" font-size="${small ? 12 : 14}" font-weight="700" fill="${pillInk}">${xml(m.verdict)}</text>`
      + (m.gap || m.goalText ? `<text x="880" y="${top + 54}" font-size="14" fill="${muted}">${xml([m.gap, m.goalText].filter(Boolean).join('・'))}</text>` : '')
      + (m.change ? `<text x="${990 + verdictW}" y="${top + 27}" font-size="14" fill="${muted}">${xml(m.change)}</text>` : '');
    return `${label}<rect x="${trackX}" y="${top + 12}" width="${trackW}" height="18" rx="3" fill="#f4f7f5"/>${zones}${lines}${fill}${ticks}${result}${item.formula ? `<rect x="250" y="${top + 62}" width="${W - 310}" height="24" rx="5" fill="#f4f8f6"/><text x="262" y="${top + 79}" font-size="14" fill="${ink}">${xml(item.formula)}</text>` : ''}<line x1="60" x2="${W - 60}" y1="${top + h - 2}" y2="${top + h - 2}" stroke="#eef3f0"/>`;
  }).join('');
  return { svg, height: items.length * rowH + items.filter(i => i.formula).length * formulaH };
}

export function buildReportSvg(input: ReportInput, scale = 1): string {
  const { detail: d, profile } = input;
  const all = wholeBodyBars(d, profile, input.previous ?? null, input.goals ?? {});
  const pick = (...labels: string[]) => labels.map(l => all.find(b => b.label === l)!).filter(Boolean);
  const info: [string, string][] = [
    ['性別', profile ? (profile.sex === 'male' ? '男' : '女') : '—'], ['年齡', profile ? `${profile.age} 歲` : '—'],
    ['身高', profile ? `${profile.heightCm.toFixed(1)} cm` : d.heightCm ? `${d.heightCm.toFixed(1)} cm` : '—'], ['量測時間', taipei(input.measuredAt)],
  ];
  const nameW = 430, colW = (W - 110 - nameW) / info.length, nameSize = Math.min(64, Math.floor(nameW / Math.max(1, [...input.name].length) * 0.95));
  let y = 196, out = '';
  out += `<text x="56" y="${y + 40}" font-size="${nameSize}" font-weight="800" fill="${ink}">${xml(input.name)}</text>`;
  out += info.map(([k, v], i) => `<text x="${60 + nameW + i * colW}" y="${y + 4}" font-size="15" fill="${muted}">${k}</text><text x="${60 + nameW + i * colW}" y="${y + 36}" font-size="${k === '量測時間' ? 20 : 25}" font-weight="700" fill="${ink}">${xml(v)}</text>`).join('');
  y += 76;
  for (const [title, labels] of [['肌肉脂肪分析', ['體重', '四肢肌肉指數']], ['肥胖分析', ['BMI', '體脂率', '內臟脂肪']], ['其他指標', ['體水分率', '肌肉品質', '代謝年齡', '肌肉評分']]] as const) {
    out += section(y, title); y += 52;
    const b = bars(pick(...labels), y); out += b.svg; y += b.height + 8;
  }
  out += section(y, '部位分析'); y += 50;
  const figW = 300, figH = 440, figs = `<svg x="40" y="${y}" width="${figW}" height="${figH}">${figureSvg(d.segments, { mode: 'muscle' })}</svg>`
    + `<svg x="${40 + figW + 10}" y="${y}" width="${figW}" height="${figH}">${figureSvg(d.segments, { mode: 'fat' })}</svg>`
    + `<text x="${40 + figW / 2}" y="${y + figH + 4}" text-anchor="middle" font-size="16" font-weight="700" fill="${brand}">部位肌肉量</text>`
    + `<text x="${50 + figW * 1.5}" y="${y + figH + 4}" text-anchor="middle" font-size="16" font-weight="700" fill="${brand}">部位體脂率</text>`;
  // Trend of weight, body fat and muscle beside the figures.
  const history = trends(input, 700, y, W - 50 - 700, figH);
  out += figs + history;
  const sources = [...new Set(all.map(b => b.range?.source).filter(Boolean))].join('；'), cut = sources.lastIndexOf('；', 70);
  const [src1, src2] = sources.length > 75 && cut > 0 ? [sources.slice(0, cut + 1), sources.slice(cut + 1)] : [sources, ''];
  const footer = `<line x1="50" x2="${W - 50}" y1="${H - 96}" y2="${H - 96}" stroke="${line}"/>`
    + `<text x="50" y="${H - 68}" font-size="13" fill="${muted}">標準出處：${xml(src1)}</text>`
    + (src2 ? `<text x="50" y="${H - 48}" font-size="13" fill="${muted}">　　　　　${xml(src2)}</text>` : '')
    + `<text x="50" y="${H - 24}" font-size="13" fill="${muted}">本報告依 TANITA RD-545 量測結果產生，僅供健康管理參考，不能取代醫療診斷；四肢肌肉指數由部位肌肉量估算，通常比醫院檢測偏高。</text>`;
  const header = `<rect width="${W}" height="140" fill="${brand}"/><text x="50" y="74" font-size="40" font-weight="700" fill="#ffffff">身體組成分析報告</text>`
    + `<text x="52" y="110" font-size="17" fill="#cfe6da">Body Composition Report・RD-545</text>`
    + `<text x="${W - 50}" y="74" text-anchor="end" font-size="22" fill="#ffffff">${xml(taipei(input.measuredAt))}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}" font-family="${font}"><rect width="${W}" height="${H}" fill="#ffffff"/>${header}${out}${footer}</svg>`;
}

/**
 * Renders the report as a 3100×4170 PNG and downloads the original file. PNG is lossless, so text and lines
 * stay sharp; downloading (instead of a share sheet) avoids chat apps shrinking the image. The SVG is sized
 * at the output resolution so the browser draws vectors at full size; 2.5× stays under iPhone's
 * 16.7-megapixel canvas limit.
 */
export async function exportReport(input: ReportInput): Promise<{ name: string; width: number; height: number; bytes: number }> {
  const scale = 2.5, width = Math.round(W * scale), height = Math.round(H * scale);
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildReportSvg(input, scale))}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('無法產生圖片')), 'image/png'));
  const name = `體組成報告-${input.name}-${taipei(input.measuredAt, false)}.png`.replace(/[\/:*?"<>|]/g, '_');
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { name, width, height, bytes: blob.size };
}
