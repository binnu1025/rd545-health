import type { BodyComposition, Segment } from '../bluetooth/bodyComposition';

/**
 * Front-facing body silhouette split into the five measured segments (InBody convention: the person faces
 * the viewer, so their right side is on the viewer's left). Returned as SVG markup so the page and the
 * JPG report draw exactly the same figure.
 */
export type SegmentKey = keyof BodyComposition['segments'];
export const segmentNames: Record<SegmentKey, string> = { rightArm: '右手', leftArm: '左手', trunk: '軀幹', rightLeg: '右腳', leftLeg: '左腳' };

const mirror = (d: string) => d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${200 - Number(x)},${y}`);
const rightArm = 'M58,82 C47,86 42,96 41,110 L36,160 C34,176 30,194 28,212 C27,222 26,230 27,238 C26,247 30,255 36,255 C42,255 45,247 43,238 C44,228 46,216 48,204 L54,164 C56,150 58,130 58,110 Z';
const rightLeg = 'M64,232 C62,262 64,292 69,320 L73,352 C75,372 75,390 75,404 C74,410 70,414 66,419 L95,419 C96,412 95,406 95,398 L96,352 C97,320 97,288 97,250 L97,240 Z';
const paths: Record<SegmentKey, string> = {
  rightArm, leftArm: mirror(rightArm), rightLeg, leftLeg: mirror(rightLeg),
  trunk: 'M100,72 C88,72 74,74 64,80 C56,85 54,94 56,104 C58,124 60,140 62,156 C63,170 60,184 60,198 C60,212 62,224 66,234 C78,242 90,245 100,245 C110,245 122,242 134,234 C138,224 140,212 140,198 C140,184 137,170 138,156 C140,140 142,124 144,104 C146,94 144,85 136,80 C126,74 112,72 100,72 Z',
};
const head = '<ellipse cx="100" cy="36" rx="21" ry="25"/><path d="M91,56 C91,64 90,69 87,74 L113,74 C110,69 109,64 109,56 Z"/>';

// Label boxes beside each segment, and where their leader line meets the body (viewBox 300×440, body offset +50).
const callouts: Record<SegmentKey, { box: [number, number]; to: [number, number] }> = {
  rightArm: { box: [4, 146], to: [86, 170] }, leftArm: { box: [236, 146], to: [214, 170] },
  trunk: { box: [120, 142], to: [150, 160] },
  rightLeg: { box: [4, 318], to: [124, 330] }, leftLeg: { box: [236, 318], to: [176, 330] },
};

export interface FigureOptions {
  mode: 'muscle' | 'fat';
  /** Inline style values so the markup also renders standalone (in the JPG report) without page CSS. */
  colors?: Partial<Record<'above' | 'standard' | 'below' | 'unknown' | 'fat' | 'skin', string>>;
}
const palette = { above: '#2f8f6f', standard: '#8fbfaa', below: '#e0a35a', unknown: '#d5ddd9', fat: '#d9a77c', skin: '#e7eeea' };
// TANITA publishes no range for its muscle score, so colour only follows its sign.
const scoreTone = (s: number | null) => s === null ? 'unknown' : s > 0 ? 'above' : s < 0 ? 'below' : 'standard';

export function figureSvg(segments: Record<SegmentKey, Segment>, options: FigureOptions): string {
  const c = { ...palette, ...options.colors };
  const keys = Object.keys(paths) as SegmentKey[];
  const value = (s: Segment) => options.mode === 'muscle' ? (s.muscleKg === null ? '—' : `${s.muscleKg.toFixed(2)} kg`) : (s.fatPct === null ? '—' : `${s.fatPct.toFixed(1)} %`);
  const fill = (k: SegmentKey) => options.mode === 'fat' ? c.fat : c[scoreTone(segments[k].muscleScore)];
  const order: SegmentKey[] = ['rightArm', 'leftArm', 'rightLeg', 'leftLeg', 'trunk'];
  const body = order.map(k => `<path d="${paths[k]}" fill="${fill(k)}" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"><title>${segmentNames[k]}：${value(segments[k])}</title></path>`).join('');
  const labels = keys.map(k => {
    const { box: [x, y], to: [tx, ty] } = callouts[k], w = 60, h = 38, trunk = k === 'trunk';
    const bx = trunk ? x - w / 2 + 30 : x;
    const leader = trunk ? '' : `<line x1="${k.startsWith('right') ? bx + w : bx}" y1="${y + h / 2}" x2="${tx}" y2="${ty}" stroke="#9fb5ab" stroke-width="1"/>`;
    return `${leader}<rect x="${bx}" y="${y}" width="${w}" height="${h}" rx="8" fill="#ffffff" fill-opacity="${trunk ? 0.9 : 1}" stroke="#d4e2da"/>`
      + `<text x="${bx + w / 2}" y="${y + 15}" text-anchor="middle" font-size="11" fill="#5d7a70">${segmentNames[k]}</text>`
      + `<text x="${bx + w / 2}" y="${y + 31}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#183d38">${value(segments[k])}</text>`;
  }).join('');
  return `<svg viewBox="0 0 300 440" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${options.mode === 'muscle' ? '部位肌肉量' : '部位體脂率'}人形圖" font-family="'Noto Sans TC','Microsoft JhengHei','PingFang TC',sans-serif">
    <g transform="translate(50 0)"><g fill="${c.skin}" stroke="#c9d8d0" stroke-width="1.5">${head}</g>${body}</g>${labels}</svg>`;
}

export function figureLegend(mode: 'muscle' | 'fat'): string {
  return mode === 'muscle'
    ? `<span><i style="background:${palette.above}"></i>肌肉評分 +</span><span><i style="background:${palette.standard}"></i>0</span><span><i style="background:${palette.below}"></i>−</span>`
    : '<span>部位體脂率沒有公開的標準範圍，只標示數值</span>';
}
