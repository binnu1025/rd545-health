import type { BodyComposition, Segment } from '../bluetooth/bodyComposition';

/**
 * Front-facing body silhouette split into the five measured segments (InBody convention: the person faces
 * the viewer, so their right side is on the viewer's left). Returned as SVG markup so the page and the
 * JPG report draw exactly the same figure.
 */
export type SegmentKey = keyof BodyComposition['segments'];
export const segmentNames: Record<SegmentKey, string> = { rightArm: '右手', leftArm: '左手', trunk: '軀幹', rightLeg: '右腳', leftLeg: '左腳' };

const mirror = (d: string) => d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${200 - Number(x)},${y}`);
// A soft pictogram: rounded segments separated by small gaps instead of outlines (body drawn in a 200-wide box).
const rightArm = 'M55,80 C46,81 41,88 40,98 L31,222 C30,233 34,240 41,240 C48,240 51,233 51,224 L57,122 C58,104 59,90 55,80 Z';
const rightLeg = 'M68,247 L97,247 C97,302 95,358 93,410 C93,419 88,424 81,424 C74,424 71,419 71,410 C69,358 67,302 68,247 Z';
const paths: Record<SegmentKey, string> = {
  rightArm, leftArm: mirror(rightArm), rightLeg, leftLeg: mirror(rightLeg),
  trunk: 'M77,68 C92,63 108,63 123,68 C136,72 142,80 141,93 L137,150 C136,172 137,200 137,222 C137,233 129,240 118,240 L82,240 C71,240 63,233 63,222 C63,200 64,172 63,150 L59,93 C58,80 64,72 77,68 Z',
};
const head = '<circle cx="100" cy="36" r="23"/>';

// Label boxes beside each segment, and where their leader line meets the body (viewBox 300×440, body offset +50).
const callouts: Record<SegmentKey, { box: [number, number]; to: [number, number] }> = {
  rightArm: { box: [2, 132], to: [92, 165] }, leftArm: { box: [222, 132], to: [208, 165] },
  trunk: { box: [150, 128], to: [150, 150] },
  rightLeg: { box: [2, 306], to: [120, 330] }, leftLeg: { box: [222, 306], to: [180, 330] },
};

export interface FigureOptions {
  mode: 'muscle' | 'fat';
  /** Inline style values so the markup also renders standalone (in the JPG report) without page CSS. */
  /** Whole-body body fat shown in the corner of the fat figure. */
  whole?: { fatPct: number | null; fatKg: number | null };
  colors?: Partial<Record<'above' | 'standard' | 'below' | 'unknown' | 'fat' | 'skin', string>>;
}
const palette = { above: '#2f8f6f', standard: '#8cc2aa', below: '#e0a35a', unknown: '#d5ddd9', fat: '#dcae86', skin: '#e3ebe7' };
// TANITA publishes no range for its muscle score, so colour only follows its sign.
const scoreTone = (s: number | null) => s === null ? 'unknown' : s > 0 ? 'above' : s < 0 ? 'below' : 'standard';

/**
 * TANITA reports a segment's muscle and fat percentage but not its fat weight. Treating the segment as fat + muscle,
 * fat = muscle × pct ÷ (100 − pct). An estimate: the segments add up to slightly less than the whole-body fat mass.
 */
export const segmentFatKg = (s: Segment) => s.muscleKg === null || s.fatPct === null || s.fatPct >= 100 ? null : s.muscleKg * s.fatPct / (100 - s.fatPct);

export function figureSvg(segments: Record<SegmentKey, Segment>, options: FigureOptions): string {
  const c = { ...palette, ...options.colors };
  const keys = Object.keys(paths) as SegmentKey[];
  const value = (s: Segment) => options.mode === 'muscle' ? (s.muscleKg === null ? '—' : `${s.muscleKg.toFixed(2)} kg`) : (s.fatPct === null ? '—' : `${s.fatPct.toFixed(1)} %`);
  const fill = (k: SegmentKey) => options.mode === 'fat' ? c.fat : c[scoreTone(segments[k].muscleScore)];
  const order: SegmentKey[] = ['rightArm', 'leftArm', 'rightLeg', 'leftLeg', 'trunk'];
  const body = order.map(k => `<path d="${paths[k]}" fill="${fill(k)}"><title>${segmentNames[k]}：${value(segments[k])}</title></path>`).join('');
  const labels = keys.map(k => {
    const fat = options.mode === 'fat', kg = fat ? segmentFatKg(segments[k]) : null, trunk = k === 'trunk';
    const { box: [x, y], to: [tx, ty] } = callouts[k], w = 76, h = fat ? 68 : 52;
    const bx = trunk ? x - w / 2 : x;
    const leader = trunk ? '' : `<line x1="${k.startsWith('right') ? bx + w : bx}" y1="${y + h / 2}" x2="${tx}" y2="${ty}" stroke="#a9bdb4" stroke-width="1"/><circle cx="${tx}" cy="${ty}" r="2.5" fill="#ffffff" stroke="#7f9a8f" stroke-width="1"/>`;
    return `${leader}<rect x="${bx}" y="${y}" width="${w}" height="${h}" rx="10" fill="#ffffff" fill-opacity="${trunk ? 0.92 : 1}" stroke="#d4e2da"/>`
      + `<text x="${bx + w / 2}" y="${y + 19}" text-anchor="middle" font-size="12.5" fill="#5d7a70">${segmentNames[k]}</text>`
      + `<text x="${bx + w / 2}" y="${y + 40}" text-anchor="middle" font-size="16" font-weight="700" fill="#183d38">${value(segments[k])}</text>`
      + (fat ? `<text x="${bx + w / 2}" y="${y + 58}" text-anchor="middle" font-size="12.5" fill="#9a5418">約 ${kg === null ? '—' : kg.toFixed(2)} kg</text>` : '');
  }).join('')
    + (options.mode === 'fat' && options.whole ? `<rect x="0" y="2" width="104" height="58" rx="10" fill="#fbf1e6" stroke="#ecd3b8"/>`
      + `<text x="52" y="22" text-anchor="middle" font-size="12.5" fill="#9a5418">全身體脂</text>`
      + `<text x="52" y="46" text-anchor="middle" font-size="14.5" font-weight="700" fill="#183d38">${options.whole.fatPct === null ? '—' : options.whole.fatPct.toFixed(1) + '%'}・${options.whole.fatKg === null ? '—' : options.whole.fatKg.toFixed(1) + 'kg'}</text>` : '');
  return `<svg viewBox="0 0 300 440" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${options.mode === 'muscle' ? '部位肌肉量' : '部位體脂率'}人形圖" font-family="'Noto Sans TC','Microsoft JhengHei','PingFang TC',sans-serif">
    <g transform="translate(50 0)"><g fill="${c.skin}">${head}</g>${body}</g>${labels}</svg>`;
}

export function figureLegend(mode: 'muscle' | 'fat'): string {
  return mode === 'muscle'
    ? `<span><i style="background:${palette.above}"></i>肌肉評分 +</span><span><i style="background:${palette.standard}"></i>0</span><span><i style="background:${palette.below}"></i>−</span>`
    : '<span>部位體脂率沒有公開的標準範圍，只標示數值；部位脂肪重（約 kg）由部位肌肉量與體脂率推算，為估計值</span>';
}
