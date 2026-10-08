/**
 * Published reference ranges only, Taiwan standards first. Where Taiwan publishes no standard, TANITA's
 * own published judgement is used and labelled as such. Metrics without any published range get none
 * (the chart then shows the value without a normal band instead of an invented one).
 */
export type Sex = 'male' | 'female';
export interface Range {
  low: number; high: number;
  /** true when a value equal to `high` is still normal (e.g. "15–25 %"), false when it already is high (BMI < 24). */
  upperInclusive: boolean;
  source: string; labels: [string, string, string];
}

const taiwanHpa = '台灣・衛福部國民健康署';
const taiwanMohw = '台灣・衛福部（雙和醫院衛教）';
const tanita = 'TANITA 官方判定（台灣無官方標準）';

// HPA adult BMI: < 18.5 underweight, 18.5 ≤ BMI < 24 healthy, 24–27 overweight, ≥ 27 obese.
export const bmiRange = (): Range => ({ low: 18.5, high: 24, upperInclusive: false, source: taiwanHpa, labels: ['過輕', '正常', '過重'] });
export function weightRange(heightCm: number): Range {
  const m2 = (heightCm / 100) ** 2;
  return { low: Math.round(18.5 * m2 * 10) / 10, high: Math.round(24 * m2 * 10) / 10, upperInclusive: false,
    source: `${taiwanHpa}（BMI 18.5–24 × 身高²）`, labels: ['過輕', '正常', '過重'] };
}

// MOHW: body fat normal 15–25 % (men), 20–30 % (women); above is obese even with a normal BMI.
export const bodyFatRange = (sex: Sex): Range => sex === 'male'
  ? { low: 15, high: 25, upperInclusive: true, source: taiwanMohw, labels: ['偏低', '正常', '肥胖'] }
  : { low: 20, high: 30, upperInclusive: true, source: taiwanMohw, labels: ['偏低', '正常', '肥胖'] };

// TANITA 内臓脂肪レベル: ≤ 9.5 標準, 10.0–14.5 やや過剰, ≥ 15.0 過剰 (ages 18–99). Lowest level the scale shows is 0.5.
export const visceralFatRange = (): Range => ({ low: 0.5, high: 9.5, upperInclusive: true, source: tanita, labels: ['', '標準', '過高'] });

// TANITA: with body fat in the proper range, body water is about 55–65 % (men) / 45–60 % (women).
export const bodyWaterRange = (sex: Sex): Range => sex === 'male'
  ? { low: 55, high: 65, upperInclusive: true, source: tanita, labels: ['偏低', '標準', '偏高'] }
  : { low: 45, high: 60, upperInclusive: true, source: tanita, labels: ['偏低', '標準', '偏高'] };

// TANITA 筋質点数 table: [age from, standard min, standard max] — 低い below min, 高い above max.
const muscleQualityRows: Record<Sex, [number, number, number][]> = {
  male: [[18, 55, 81], [30, 53, 79], [40, 49, 76], [50, 45, 71], [60, 38, 64], [70, 30, 55], [80, 26, 50]],
  female: [[18, 60, 87], [30, 59, 84], [40, 56, 79], [50, 50, 73], [60, 43, 65], [70, 33, 57], [80, 27, 52]],
};
export function muscleQualityRange(sex: Sex, age: number): Range | null {
  if (age < 18) return null;
  const row = [...muscleQualityRows[sex]].reverse().find(([from]) => age >= from)!;
  return { low: row[1], high: row[2], upperInclusive: true, source: tanita, labels: ['偏低', '標準', '偏高'] };
}

export type Judgement = 'low' | 'normal' | 'high';
export function judge(value: number, range: Range): Judgement {
  if (value < range.low) return 'low';
  return value > range.high || (!range.upperInclusive && value === range.high) ? 'high' : 'normal';
}
