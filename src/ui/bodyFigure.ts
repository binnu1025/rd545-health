import type { BodyComposition } from '../bluetooth/bodyComposition';
import { appendicularMuscleIndex, appendicularMuscleRange, bmiRange, bodyFatRange, bodyWaterRange, muscleQualityRange, visceralFatRange, weightRange, type Sex } from '../health/standards';
import { renderBars, type BarItem } from './bodyBars';
import { figureLegend, figureSvg, segmentNames, type SegmentKey } from './figure';

const fmt = (value: number | null, digits = 1) => value === null ? '—' : value.toFixed(digits);
const signed = (value: number | null) => value === null ? '—' : value > 0 ? `+${value}` : String(value);
// Colour follows the sign of TANITA's muscle score only; TANITA publishes no range for it.
const scoreClass = (value: number | null) => value === null ? 'unknown' : value > 0 ? 'above' : value < 0 ? 'below' : 'standard';

export interface ReportProfile { sex: Sex; age: number; heightCm: number }

const asmi = (d: BodyComposition, heightCm: number | null) => appendicularMuscleIndex(['rightArm', 'leftArm', 'rightLeg', 'leftLeg'].map(k => d.segments[k as SegmentKey].muscleKg), heightCm);

export interface Goals { weightKg?: number | null; bodyFatPct?: number | null }
export function wholeBodyBars(d: BodyComposition, profile: ReportProfile | null, previous: BodyComposition | null = null, goals: Goals = {}): BarItem[] {
  const height = profile?.heightCm ?? d.heightCm;
  const items: BarItem[] = [
    { label: '體重', unit: 'kg', value: d.weightKg, digits: 1, range: height ? weightRange(height) : null },
    { label: 'BMI', unit: 'kg/m²', value: d.bmi, digits: 1, range: bmiRange() },
    { label: '體脂率', unit: '%', value: d.bodyFatPct, digits: 1, range: profile ? bodyFatRange(profile.sex) : null, note: '需性別才能判定' },
    { label: '內臟脂肪', unit: '等級', value: d.visceralFat, digits: 1, range: visceralFatRange() },
    { label: '體水分率', unit: '%', value: d.bodyWaterPct, digits: 1, range: profile ? bodyWaterRange(profile.sex) : null, note: '需性別才能判定' },
    { label: '肌肉品質', unit: '分', value: d.muscleQuality, digits: 0, range: profile ? muscleQualityRange(profile.sex, profile.age) : null, note: '需性別年齡才能判定' },
    { label: '代謝年齡', unit: '歲', value: d.metabolicAge, digits: 0,
      marker: profile ? { value: profile.age, label: `實際 ${profile.age}`, describe: diff => diff > 0 ? `比實際年齡大 ${diff} 歲` : diff < 0 ? `比實際年齡年輕 ${-diff} 歲` : '與實際年齡相同' } : undefined },
    { label: '肌肉量', unit: 'kg', value: d.muscleMassKg, digits: 1 },
    { label: '四肢肌肉指數', unit: 'kg/m²', value: asmi(d, height), digits: 2, range: profile ? appendicularMuscleRange(profile.sex) : null, note: '需性別才能判定' },
    { label: '肌肉評分', unit: '-4～+4', value: d.muscleScore, digits: 0, axis: [-4, 4], note: 'TANITA 評分，無公開範圍' },
    { label: '骨量', unit: 'kg', value: d.boneMassKg, digits: 1 },
    { label: '基礎代謝', unit: 'kcal', value: d.bmrKcal, digits: 0 },
  ];
  if (previous) {
    const before: Record<string, number | null> = { 體重: previous.weightKg, BMI: previous.bmi, 體脂率: previous.bodyFatPct, 內臟脂肪: previous.visceralFat, 體水分率: previous.bodyWaterPct,
      肌肉品質: previous.muscleQuality, 代謝年齡: previous.metabolicAge, 肌肉量: previous.muscleMassKg, 四肢肌肉指數: asmi(previous, height), 肌肉評分: previous.muscleScore, 骨量: previous.boneMassKg, 基礎代謝: previous.bmrKcal };
    for (const item of items) item.previous = before[item.label] ?? null;
  }
  const limbs = (['rightArm', 'leftArm', 'rightLeg', 'leftLeg'] as const).map(k => d.segments[k].muscleKg), asmiItem = items.find(i => i.label === '四肢肌肉指數')!;
  if (asmiItem.value !== null && height) {
    const sum = (limbs as number[]).reduce((a, b) => a + b, 0), m = height / 100;
    asmiItem.formula = `公式：（兩手＋兩腳肌肉 ${sum.toFixed(1)} kg）÷（身高 ${m.toFixed(2)} m × ${m.toFixed(2)} m）＝ ${asmiItem.value.toFixed(2)}；`
      + (profile ? `低於 ${profile.sex === 'male' ? '7.0（男）' : '5.7（女）'} 就有肌少症風險` : '男性低於 7.0、女性低於 5.7 就有肌少症風險');
  }
  for (const item of items) {
    if (item.label === '體重') item.goal = goals.weightKg ?? null;
    if (item.label === '體脂率') item.goal = goals.bodyFatPct ?? null;
  }
  return items;
}

export function renderBodyComposition(detail: BodyComposition, measuredAtText: string, profile: ReportProfile | null = null, profileSource = '體脂計個人設定', extra: { previous?: BodyComposition | null; goals?: Goals } = {}): HTMLElement {
  const root = document.createElement('section');
  root.className = 'body-report';
  const keys = Object.keys(segmentNames) as SegmentKey[];
  const segmentRows = keys.map(k => { const s = detail.segments[k]; return `<tr><th>${segmentNames[k]}</th><td>${fmt(s.muscleKg, 2)} kg</td><td>${fmt(s.fatPct)} %</td><td class="${scoreClass(s.muscleScore)}">${signed(s.muscleScore)}</td><td>${fmt(s.muscleQuality, 0)}</td></tr>`; }).join('');
  const who = profile ? `${profile.sex === 'male' ? '男' : '女'}・${profile.age} 歲・${fmt(profile.heightCm)} cm（${profileSource}）` : '未取得性別、年齡，僅能判定 BMI、體重與內臟脂肪';
  root.innerHTML = `<h3>身體組成　<small>${measuredAtText}（台北時間）</small></h3><p class="hint who">${who}</p>
    <h4>肌肉脂肪分析</h4><div class="bars-host"></div>
    <h4>部位分析</h4>
    <div class="figures"><figure><figcaption>部位肌肉量</figcaption>${figureSvg(detail.segments, { mode: 'muscle' })}<p class="legend">${figureLegend('muscle')}</p></figure>
      <figure><figcaption>部位體脂率</figcaption>${figureSvg(detail.segments, { mode: 'fat' })}<p class="legend">${figureLegend('fat')}</p></figure></div>
    <table class="segments"><thead><tr><th>部位</th><th>肌肉量</th><th>體脂率</th><th>肌肉評分</th><th>肌肉品質</th></tr></thead><tbody>${segmentRows}</tbody></table>`;
  root.querySelector('.bars-host')!.replaceWith(renderBars(wholeBodyBars(detail, profile, extra.previous ?? null, extra.goals)));
  return root;
}
