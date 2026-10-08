import type { BodyComposition } from '../bluetooth/bodyComposition';
import { barModel, fmt, type BarItem } from '../ui/bodyBars';
import { wholeBodyBars, type ReportProfile } from '../ui/bodyFigure';
import { figureSvg } from '../ui/figure';

/** One-page, InBody-style report drawn as a single SVG, then rasterised to JPG for saving or sharing. */
export interface ReportInput {
  name: string; profile: ReportProfile | null; measuredAt: Date; detail: BodyComposition;
  history: { at: Date; weight: number | null; fat: number | null; muscle: number | null }[];
}

const W = 1240, H = 1754;
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

/** Bar rows: label | track with zones and fill | value, verdict and distance from normal. */
function bars(items: BarItem[], y: number): { svg: string; height: number } {
  const trackX = 250, trackW = 600, rowH = 66;
  const svg = items.map((item, i) => {
    const top = y + i * rowH, m = barModel(item);
    const label = `<text x="70" y="${top + 26}" font-size="20" font-weight="700" fill="${ink}">${xml(item.label)}</text><text x="70" y="${top + 47}" font-size="14" fill="${muted}">${xml(item.unit)}</text>`;
    if (!m) return `${label}<rect x="${trackX}" y="${top + 12}" width="${trackW}" height="18" rx="3" fill="#f1f4f2"/><text x="880" y="${top + 28}" font-size="20" fill="${muted}">—</text>`;
    const px = (pct: number) => trackX + trackW * pct / 100;
    const zones = m.zones ? `<rect x="${trackX}" y="${top + 12}" width="${trackW * m.zones.low / 100}" height="18" fill="#eef1f0"/>`
      + `<rect x="${px(m.zones.low)}" y="${top + 12}" width="${trackW * (m.zones.high - m.zones.low) / 100}" height="18" fill="#cfe6da"/>`
      + `<rect x="${px(m.zones.high)}" y="${top + 12}" width="${trackW * (100 - m.zones.high) / 100}" height="18" fill="#f6e7d6"/>` : '';
    const lines = [m.markerAt, m.zeroAt].filter((v): v is number => v !== null).map(at => `<rect x="${px(at) - 1}" y="${top + 8}" width="2" height="26" fill="${ink}" opacity="0.7"/>`).join('');
    const ticks = m.ticks.map(t => `<text x="${px(t.at)}" y="${top + 50}" text-anchor="middle" font-size="13" fill="${t.strong ? ink : muted}" font-weight="${t.strong ? 700 : 400}">${xml(t.label)}</text>`).join('');
    const fill = `<rect x="${px(m.fillFrom)}" y="${top + 17}" width="${Math.max(3, trackW * m.fillWidth / 100)}" height="8" rx="4" fill="${stateColor[m.state]}"/>`;
    const [pillBg, pillInk] = pillColor[m.state], verdictW = 22 + m.verdict.length * 15;
    const result = `<text x="880" y="${top + 30}" font-size="26" font-weight="700" fill="${ink}">${fmt(m.value, item.digits)}</text>`
      + `<rect x="${980}" y="${top + 9}" width="${verdictW}" height="26" rx="13" fill="${pillBg}"/><text x="${980 + verdictW / 2}" y="${top + 27}" text-anchor="middle" font-size="14" font-weight="700" fill="${pillInk}">${xml(m.verdict)}</text>`
      + (m.gap ? `<text x="880" y="${top + 54}" font-size="14" fill="${muted}">${xml(m.gap)}</text>` : '');
    return `${label}<rect x="${trackX}" y="${top + 12}" width="${trackW}" height="18" rx="3" fill="#f4f7f5"/>${zones}${lines}${fill}${ticks}${result}<line x1="60" x2="${W - 60}" y1="${top + rowH - 2}" y2="${top + rowH - 2}" stroke="#eef3f0"/>`;
  }).join('');
  return { svg, height: items.length * rowH };
}

export function buildReportSvg(input: ReportInput): string {
  const { detail: d, profile } = input;
  const all = wholeBodyBars(d, profile);
  const pick = (...labels: string[]) => labels.map(l => all.find(b => b.label === l)!).filter(Boolean);
  const info: [string, string][] = [
    ['姓名', input.name], ['性別', profile ? (profile.sex === 'male' ? '男' : '女') : '—'], ['年齡', profile ? `${profile.age} 歲` : '—'],
    ['身高', profile ? `${profile.heightCm.toFixed(1)} cm` : d.heightCm ? `${d.heightCm.toFixed(1)} cm` : '—'], ['量測時間', taipei(input.measuredAt)],
  ];
  const colW = (W - 100) / info.length;
  let y = 196, out = '';
  out += info.map(([k, v], i) => `<text x="${60 + i * colW}" y="${y}" font-size="15" fill="${muted}">${k}</text><text x="${60 + i * colW}" y="${y + 32}" font-size="${k === '量測時間' ? 21 : 25}" font-weight="700" fill="${ink}">${xml(v)}</text>`).join('');
  y += 64;
  for (const [title, labels] of [['肌肉脂肪分析', ['體重', '肌肉量', '骨量']], ['肥胖分析', ['BMI', '體脂率', '內臟脂肪']], ['其他指標', ['體水分率', '肌肉品質', '基礎代謝', '代謝年齡', '肌肉評分']]] as const) {
    out += section(y, title); y += 52;
    const b = bars(pick(...labels), y); out += b.svg; y += b.height + 8;
  }
  out += section(y, '部位分析'); y += 50;
  const figW = 300, figH = 440, figs = `<svg x="40" y="${y}" width="${figW}" height="${figH}">${figureSvg(d.segments, { mode: 'muscle' })}</svg>`
    + `<svg x="${40 + figW + 10}" y="${y}" width="${figW}" height="${figH}">${figureSvg(d.segments, { mode: 'fat' })}</svg>`
    + `<text x="${40 + figW / 2}" y="${y + figH + 4}" text-anchor="middle" font-size="16" font-weight="700" fill="${brand}">部位肌肉量</text>`
    + `<text x="${50 + figW * 1.5}" y="${y + figH + 4}" text-anchor="middle" font-size="16" font-weight="700" fill="${brand}">部位體脂率</text>`;
  // Recent history beside the figures.
  const hx = 720, rows = input.history.slice(-8).reverse();
  const head = ['日期', '體重 kg', '體脂率 %', '肌肉量 kg'], cx = [hx, hx + 150, hx + 270, hx + 390];
  const history = `<text x="${hx}" y="${y + 24}" font-size="19" font-weight="700" fill="${ink}">近期變化</text>`
    + head.map((h, i) => `<text x="${cx[i]}" y="${y + 62}" font-size="14" fill="${muted}">${h}</text>`).join('')
    + rows.map((r, i) => {
      const ry = y + 96 + i * 38, current = +r.at === +input.measuredAt;
      const cell = (v: number | null, digits: number) => v === null ? '—' : v.toFixed(digits);
      return `${current ? `<rect x="${hx - 10}" y="${ry - 25}" width="480" height="36" rx="6" fill="#edf4ef"/>` : ''}`
        + [taipei(r.at, false), cell(r.weight, 1), cell(r.fat, 1), cell(r.muscle, 1)].map((v, j) => `<text x="${cx[j]}" y="${ry}" font-size="17" font-weight="${current ? 700 : 400}" fill="${ink}">${v}</text>`).join('');
    }).join('')
    + (rows.length < 2 ? `<text x="${hx}" y="${y + 96 + rows.length * 38}" font-size="14" fill="${muted}">量測兩次以上就會顯示變化</text>` : '');
  out += figs + history;
  const sources = [...new Set(all.map(b => b.range?.source).filter(Boolean))].join('；');
  const footer = `<line x1="50" x2="${W - 50}" y1="${H - 92}" y2="${H - 92}" stroke="${line}"/>`
    + `<text x="50" y="${H - 64}" font-size="13" fill="${muted}">標準出處：${xml(sources)}</text>`
    + `<text x="50" y="${H - 40}" font-size="13" fill="${muted}">本報告依 TANITA RD-545 體組成計的量測結果產生，僅供健康管理參考，不能取代醫療診斷。</text>`;
  const header = `<rect width="${W}" height="140" fill="${brand}"/><text x="50" y="74" font-size="40" font-weight="700" fill="#ffffff">身體組成分析報告</text>`
    + `<text x="52" y="110" font-size="17" fill="#cfe6da">Body Composition Report・RD-545</text>`
    + `<text x="${W - 50}" y="74" text-anchor="end" font-size="22" fill="#ffffff">${xml(taipei(input.measuredAt))}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}"><rect width="${W}" height="${H}" fill="#ffffff"/>${header}${out}${footer}</svg>`;
}

/** Renders the report to a JPG; on phones that can share files it opens the share sheet, otherwise it downloads. */
export async function exportReportJpg(input: ReportInput): Promise<'shared' | 'downloaded'> {
  const svg = buildReportSvg(input);
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const scale = 2, canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale); ctx.drawImage(image, 0, 0, W, H);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('無法產生圖片')), 'image/jpeg', 0.92));
  const name = `體組成報告-${input.name}-${taipei(input.measuredAt, false)}.jpg`.replace(/[\\/:*?"<>|]/g, '_');
  const file = new File([blob], name, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'shared'; }
    catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return 'shared'; }
  }
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
