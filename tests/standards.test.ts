import { expect, it } from 'vitest';
import { bmiRange, bodyFatRange, bodyWaterRange, judge, muscleQualityRange, visceralFatRange, weightRange } from '../src/health/standards';
import { ageAt, decodeScaleProfile } from '../src/bluetooth/userProfile';

it('applies Taiwan BMI / weight boundaries (24 is already overweight)', () => {
  expect(judge(18.4, bmiRange())).toBe('low'); expect(judge(18.5, bmiRange())).toBe('normal');
  expect(judge(23.9, bmiRange())).toBe('normal'); expect(judge(24, bmiRange())).toBe('high');
  expect(weightRange(170)).toMatchObject({ low: 53.5, high: 69.4 });
});
it('applies Taiwan body fat (15–25 % men, 20–30 % women, upper bound inclusive)', () => {
  expect(judge(25, bodyFatRange('male'))).toBe('normal'); expect(judge(25.1, bodyFatRange('male'))).toBe('high');
  expect(judge(14.9, bodyFatRange('male'))).toBe('low'); expect(judge(30, bodyFatRange('female'))).toBe('normal');
});
it('applies TANITA visceral fat, body water and age-banded muscle quality where Taiwan has none', () => {
  expect(judge(9.5, visceralFatRange())).toBe('normal'); expect(judge(10, visceralFatRange())).toBe('high');
  expect(bodyWaterRange('female')).toMatchObject({ low: 45, high: 60 });
  expect(muscleQualityRange('male', 36)).toMatchObject({ low: 53, high: 79 });
  expect(muscleQualityRange('female', 85)).toMatchObject({ low: 27, high: 52 });
  expect(judge(79, muscleQualityRange('male', 36)!)).toBe('normal'); expect(judge(80, muscleQualityRange('male', 36)!)).toBe('high');
  expect(muscleQualityRange('male', 17)).toBeNull();
});
it('decodes sex / birth / height from a synthetic scale profile and skips the nickname', () => {
  // Synthetic: female, born 1990-01-01 (days since 1900-01-01 = 32872, stored +1), 160.0 cm, nickname "TEST".
  const body = [0x6a, 0x32, 0, 0, 0x6a, 0x33, 0, 0, 0, 0x7e, 0x22, 4, 0x54, 0x45, 0x53, 0x54, 0x6a, 0x3c, 32873 >> 8, 32873 & 255,
    0x6a, 0x37, 1, 0x6a, 0x38, 0, 0x6a, 0x3e, 1600 >> 8, 1600 & 255, 0x6a, 0x3b, 0, 0x60, 0x4f, 0, 0, 0x6a, 0x13, 0, 0x6a, 0x15, 0, 0, 0, 1];
  const f = Uint8Array.from([0, 0, 0x90, 0x00, 0, ...body, 0]); f[1] = f.length - 2; f[f.length - 1] = (255 - f.reduce((a, b) => a + b, 0)) & 255;
  const p = decodeScaleProfile(f)!;
  expect(p).toMatchObject({ sex: 'female', heightCm: 160 }); expect(p.birthDate.toISOString().slice(0, 10)).toBe('1990-01-01');
  expect(ageAt(p.birthDate, new Date('2025-12-31T15:59:00Z'))).toBe(35); // 23:59 Taipei, the day before the birthday
  expect(ageAt(p.birthDate, new Date('2025-12-31T16:00:00Z'))).toBe(36); // 00:00 Taipei on the birthday
  const unknown = f.slice(); unknown[5] = 0x12; expect(decodeScaleProfile(unknown)).toBeNull();
});
