import type { BodyComposition, Segment } from '../bluetooth/bodyComposition';
import { bmiRange, bodyFatRange, bodyWaterRange, muscleQualityRange, visceralFatRange, weightRange, type Sex } from '../health/standards';
import { renderBars, type BarItem } from './bodyBars';

const fmt = (value: number | null, digits = 1) => value === null ? '—' : value.toFixed(digits);
const signed = (value: number | null) => value === null ? '—' : value > 0 ? `+${value}` : String(value);
// Colour follows the sign of TANITA's muscle score only; TANITA publishes no range for it.
const scoreClass = (value: number | null) => value === null ? 'unknown' : value > 0 ? 'above' : value < 0 ? 'below' : 'standard';

type SegmentKey = keyof BodyComposition['segments'];
// The figure faces the viewer, so the person's right side is drawn on the viewer's left (InBody convention).
const shapes: Record<SegmentKey, string> = {
  rightArm: 'M70 92 C58 96 52 108 50 122 L40 196 C39 204 50 207 53 199 L68 132 Z',
  leftArm: 'M170 92 C182 96 188 108 190 122 L200 196 C201 204 190 207 187 199 L172 132 Z',
  trunk: 'M76 84 C92 78 148 78 164 84 C172 88 174 100 172 112 L166 186 C165 196 75 196 74 186 L68 112 C66 100 68 88 76 84 Z',
  rightLeg: 'M78 198 L116 198 L114 300 C113 312 92 312 92 300 Z',
  leftLeg: 'M124 198 L162 198 L148 300 C147 312 126 312 126 300 Z',
};
const labels: Record<SegmentKey, { name: string; x: number; y: number; anchor: 'start' | 'end' | 'middle' }> = {
  rightArm: { name: '右手', x: 4, y: 128, anchor: 'start' },
  leftArm: { name: '左手', x: 316, y: 128, anchor: 'end' },
  trunk: { name: '軀幹', x: 160, y: 124, anchor: 'middle' },
  rightLeg: { name: '右腳', x: 4, y: 262, anchor: 'start' },
  leftLeg: { name: '左腳', x: 316, y: 262, anchor: 'end' },
};

function segmentLabel(key: SegmentKey, segment: Segment) {
  const { name, x, y, anchor } = labels[key];
  // The trunk label sits on the shape, so give it a light plate for contrast on any fill.
  return (key === 'trunk' ? `<rect x="${x - 40}" y="${y - 14}" width="80" height="48" rx="6" class="plate"/>` : '')
    + `<text x="${x}" y="${y}" text-anchor="${anchor}" class="seg-name">${name}</text>`
    + `<text x="${x}" y="${y + 15}" text-anchor="${anchor}" class="seg-value">肌 ${fmt(segment.muscleKg, 2)} kg</text>`
    + `<text x="${x}" y="${y + 29}" text-anchor="${anchor}" class="seg-value">脂 ${fmt(segment.fatPct)} %</text>`;
}

export interface ReportProfile { sex: Sex; age: number; heightCm: number }

function wholeBodyBars(d: BodyComposition, profile: ReportProfile | null): BarItem[] {
  const height = profile?.heightCm ?? d.heightCm;
  return [
    { label: '體重', unit: 'kg', value: d.weightKg, digits: 1, range: height ? weightRange(height) : null },
    { label: 'BMI', unit: 'kg/m²', value: d.bmi, digits: 1, range: bmiRange() },
    { label: '體脂率', unit: '%', value: d.bodyFatPct, digits: 1, range: profile ? bodyFatRange(profile.sex) : null, note: '需性別才能判定' },
    { label: '內臟脂肪', unit: '等級', value: d.visceralFat, digits: 1, range: visceralFatRange() },
    { label: '體水分率', unit: '%', value: d.bodyWaterPct, digits: 1, range: profile ? bodyWaterRange(profile.sex) : null, note: '需性別才能判定' },
    { label: '肌肉品質', unit: '分', value: d.muscleQuality, digits: 0, range: profile ? muscleQualityRange(profile.sex, profile.age) : null, note: '需性別年齡才能判定' },
    { label: '代謝年齡', unit: '歲', value: d.metabolicAge, digits: 0,
      marker: profile ? { value: profile.age, label: `實際 ${profile.age}`, describe: diff => diff > 0 ? `比實際年齡大 ${diff} 歲` : diff < 0 ? `比實際年齡年輕 ${-diff} 歲` : '與實際年齡相同' } : undefined },
    { label: '肌肉量', unit: 'kg', value: d.muscleMassKg, digits: 1 },
    { label: '肌肉評分', unit: '-4～+4', value: d.muscleScore, digits: 0, axis: [-4, 4], note: 'TANITA 評分，無公開範圍' },
    { label: '骨量', unit: 'kg', value: d.boneMassKg, digits: 1 },
    { label: '基礎代謝', unit: 'kcal', value: d.bmrKcal, digits: 0 },
  ];
}

export function renderBodyComposition(detail: BodyComposition, measuredAtText: string, profile: ReportProfile | null = null): HTMLElement {
  const root = document.createElement('section');
  root.className = 'body-report';
  const keys = Object.keys(shapes) as SegmentKey[];
  const figure = `<svg viewBox="0 0 320 320" role="img" aria-label="各部位肌肉量與體脂率人形圖">
    <g transform="translate(40 0)"><circle cx="120" cy="50" r="24" class="head"/>
    ${keys.map(k => `<path d="${shapes[k]}" class="seg ${scoreClass(detail.segments[k].muscleScore)}"><title>${labels[k].name}：肌肉評分 ${signed(detail.segments[k].muscleScore)}</title></path>`).join('')}</g>
    ${keys.map(k => segmentLabel(k, detail.segments[k])).join('')}
  </svg>`;
  const segmentRows = keys.map(k => { const s = detail.segments[k]; return `<tr><th>${labels[k].name}</th><td>${fmt(s.muscleKg, 2)} kg</td><td>${fmt(s.fatPct)} %</td><td class="${scoreClass(s.muscleScore)}">${signed(s.muscleScore)}</td><td>${fmt(s.muscleQuality, 0)}</td></tr>`; }).join('');
  const who = profile ? `${profile.sex === 'male' ? '男' : '女'}・${profile.age} 歲・${fmt(profile.heightCm)} cm（體脂計個人設定）` : '未取得體脂計個人設定，僅能判定 BMI、體重與內臟脂肪';
  root.innerHTML = `<h3>身體組成　<small>${measuredAtText}（台北時間）</small></h3><p class="hint who">${who}</p>
    <h4>肌肉脂肪分析</h4><div class="bars-host"></div>
    <h4>部位分析</h4>
    <div class="body-grid"><div class="figure">${figure}<p class="legend"><i class="above"></i>肌肉評分 + <i class="standard"></i>0 <i class="below"></i>−</p></div>
    <table class="segments"><thead><tr><th>部位</th><th>肌肉量</th><th>體脂率</th><th>肌肉評分</th><th>肌肉品質</th></tr></thead><tbody>${segmentRows}</tbody></table></div>`;
  root.querySelector('.bars-host')!.replaceWith(renderBars(wholeBodyBars(detail, profile)));
  return root;
}
