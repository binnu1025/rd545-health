import { expect, it } from 'vitest';
import { barModel } from '../src/ui/bodyBars';

it('describes the change since last time without judging it', () => {
  const item = { label: '體重', unit: 'kg', value: 80.2, digits: 1 };
  expect(barModel({ ...item, previous: 81 })!.change).toBe('比上次 ▼0.8 kg');
  expect(barModel({ ...item, previous: 79.7 })!.change).toBe('比上次 ▲0.5 kg');
  expect(barModel({ ...item, previous: 80.2 })!.change).toBe('與上次相同');
  expect(barModel(item)!.change).toBe('');
});
it('places the goal on the track and says how far it is', () => {
  const m = barModel({ label: '體重', unit: 'kg', value: 80, digits: 1, goal: 75 })!;
  expect(m.goalText).toBe('距目標 −5.0 kg');
  expect(m.goalAt).toBeGreaterThan(0); expect(m.goalAt).toBeLessThan(100);
  expect(barModel({ label: '體重', unit: 'kg', value: 75, digits: 1, goal: 75 })!.goalText).toBe('已達成目標');
  expect(barModel({ label: '體脂率', unit: '%', value: 18, digits: 1, goal: 20 })!.goalText).toBe('距目標 +2.0 %');
});
