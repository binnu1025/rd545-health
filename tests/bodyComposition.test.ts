import { expect, it } from 'vitest';
import { decodeBodyComposition } from '../src/bluetooth/bodyComposition';
// Tag order and sizes as walked on real RD-545AS results; every value below is synthetic.
const layout: [number, number][] = [[0x6a32,2],[0x6a33,3],[0x6a38,1],[0x6a3e,2],[0x6a3b,1],[0x6021,2],[0x6056,2],[0x6022,2],[0x6042,2],[0x603c,2],
  [0x6036,2],[0x6030,2],[0x6048,2],[0x6070,1],[0x6023,2],[0x6045,2],[0x603f,2],[0x6039,2],[0x6033,2],[0x604b,2],[0x6029,2],[0x6074,1],[0x6073,1],
  [0x6072,1],[0x6071,1],[0x6075,1],[0x6076,1],[0x6024,1],[0x6077,1],[0x6047,1],[0x607b,1],[0x6041,1],[0x607a,1],[0x603b,1],[0x6079,1],[0x6035,1],
  [0x6078,1],[0x604d,1],[0x607c,1],[0x605a,1],[0x6027,2],[0x602f,2],[0x6028,1],[0x6025,2],[0x607d,1],[0x602b,2],[0x605b,1],[0x607e,1],[0x605c,1],
  [0x6621,1],[0x605d,1],[0x6622,1],[0x605e,1],[0x6623,1],[0x605f,1],[0x6624,1],[0x606c,1],[0x606d,1],[0x606e,1],[0x606f,1],[0x6f21,2],[0x6f22,2],
  [0x6143,2],[0x613b,2],[0x6133,2],[0x612b,2],[0x6123,2],[0x6721,2],[0x614b,2],[0x6722,2],[0x6144,2],[0x613c,2],[0x6134,2],[0x612c,2],[0x6124,2],
  [0x6723,2],[0x614c,2],[0x6724,2],[0x6725,2],[0x6726,2],[0x6727,2],[0x6728,2],[0x6729,2],[0x672a,2],[0x6152,2],[0x672b,2],[0x672c,2],[0x672d,2],
  [0x672e,2],[0x672f,2],[0x6730,2],[0x6731,2],[0x6151,2],[0x6732,2]];
function frame(values: Record<number, number> = {}) {
  const f = new Uint8Array(346); f[0] = 1; f[1] = 88; f[2] = 0xb0; f[3] = 0x10; f[5] = 1;
  let i = 6;
  for (const [tag, size] of layout) { f[i] = tag >> 8; f[i + 1] = tag & 255; const v = values[tag] ?? 0; for (let k = 0; k < size; k++) f[i + 2 + k] = (v >> (8 * (size - 1 - k))) & 255; i += 2 + size; }
  expect(i).toBe(345);
  return f;
}
it('walks the full layout and scales whole-body and segment values like the official readers', () => {
  const d = decodeBodyComposition(frame({ 0x6a3e: 1650, 0x6021: 6000, 0x6022: 200, 0x6023: 4500, 0x6024: 0x82, 0x6027: 1500, 0x6025: 55,
    0x603c: 150, 0x603f: 250, 0x6041: 3, 0x605d: 80, 0x6030: 0xffff, 0x6033: 900 }))!;
  expect(d.heightCm).toBe(165); expect(d.weightKg).toBe(60); expect(d.bodyFatPct).toBe(20); expect(d.muscleMassKg).toBe(45);
  expect(d.muscleScore).toBe(-2); expect(d.bmrKcal).toBe(1500); expect(d.visceralFat).toBe(5.5);
  expect(d.segments.rightArm).toEqual({ fatPct: 15, muscleKg: 2.5, muscleScore: 3, muscleQuality: 80 });
  expect(d.segments.rightLeg.fatPct).toBeNull(); expect(d.segments.rightLeg.muscleKg).toBe(9);
  expect(d.segments.trunk.muscleQuality).toBeNull();
});
it('rejects unknown tags or a misaligned layout instead of guessing', () => {
  const unknown = frame(); unknown[15] = 0x12; expect(decodeBodyComposition(unknown)).toBeNull();
  const shifted = frame(); shifted.copyWithin(7, 6, 344); expect(decodeBodyComposition(shifted)).toBeNull();
});
