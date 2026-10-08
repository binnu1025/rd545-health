/**
 * Full b010 tag walk. Tags carry no length byte, so each tag's size comes from the official parser
 * (jp/co/tanita/comm/ble/d.java readers: x/t/w = 2 bytes, read() = 1, z = 3). The table was verified by
 * walking real RD-545AS results end to end; any unknown tag or misaligned end rejects the whole detail.
 */
const oneByte = new Set([0x6024, 0x6028, 0x6035, 0x603b, 0x6041, 0x6047, 0x604d, 0x6a38, 0x6a3b, 0x6621, 0x6622, 0x6623, 0x6624]);
for (const [from, to] of [[0x605a, 0x605f], [0x606c, 0x606f], [0x6070, 0x607e]]) for (let t = from; t <= to; t++) oneByte.add(t);
const twoByte = new Set([0x6a32, 0x6a3e, 0x6021, 0x6022, 0x6023, 0x6025, 0x6027, 0x6029, 0x602b, 0x602f, 0x6030, 0x6033, 0x6036, 0x6039,
  0x603c, 0x603f, 0x6042, 0x6045, 0x6048, 0x604b, 0x6056, 0x6f21, 0x6f22, 0x6123, 0x6124, 0x612b, 0x612c, 0x6133, 0x6134, 0x613b, 0x613c,
  0x6143, 0x6144, 0x614b, 0x614c, 0x6151, 0x6152]);
for (let t = 0x6721; t <= 0x6732; t++) twoByte.add(t);
const sizeOf = (tag: number) => tag === 0x6a33 ? 3 : oneByte.has(tag) ? 1 : twoByte.has(tag) ? 2 : 0;

export interface Segment { fatPct: number | null; muscleKg: number | null; muscleScore: number | null; muscleQuality: number | null }
export interface BodyComposition {
  heightCm: number | null; weightKg: number | null; bmi: number | null; bodyFatPct: number | null; muscleMassKg: number | null;
  muscleScore: number | null; boneMassKg: number | null; bmrKcal: number | null; metabolicAge: number | null; visceralFat: number | null;
  bodyWaterPct: number | null; muscleQuality: number | null;
  segments: { rightArm: Segment; leftArm: Segment; trunk: Segment; rightLeg: Segment; leftLeg: Segment };
}

export function decodeBodyComposition(frame: Uint8Array): BodyComposition | null {
  const raw = new Map<number, number>();
  let i = 6;
  while (i < frame.length - 1) {
    const tag = frame[i] * 256 + frame[i + 1], size = sizeOf(tag);
    if (!size || i + 2 + size > frame.length - 1) return null;
    let value = 0;
    for (let k = 0; k < size; k++) value = value * 256 + frame[i + 2 + k];
    raw.set(tag, value); i += 2 + size;
  }
  if (i !== frame.length - 1) return null;
  // 0xFFFF / 0xFF mark "Error" in the official readers.
  const num = (tag: number, scale = 1) => { const v = raw.get(tag); return v === undefined || v === 0xffff ? null : v / scale; };
  const byte = (tag: number) => { const v = raw.get(tag); return v === undefined || v === 0xff ? null : v; };
  // Official signed byte: bit 7 set means negative magnitude in the low 7 bits.
  const score = (tag: number) => { const v = byte(tag); return v === null ? null : v & 0x80 ? -(v & 0x7f) : v; };
  const segment = (fat: number, muscle: number, muscleScoreTag: number, quality?: number): Segment =>
    ({ fatPct: num(fat, 10), muscleKg: num(muscle, 100), muscleScore: score(muscleScoreTag), muscleQuality: quality ? byte(quality) : null });
  return {
    heightCm: num(0x6a3e, 10), weightKg: num(0x6021, 100), bmi: num(0x6056, 10), bodyFatPct: num(0x6022, 10), muscleMassKg: num(0x6023, 100),
    muscleScore: score(0x6024), boneMassKg: num(0x6029, 100), bmrKcal: num(0x6027), metabolicAge: byte(0x6028), visceralFat: num(0x6025, 10),
    bodyWaterPct: num(0x602b, 10), muscleQuality: byte(0x605b),
    segments: {
      rightArm: segment(0x603c, 0x603f, 0x6041, 0x605d), leftArm: segment(0x6042, 0x6045, 0x6047, 0x605c),
      trunk: segment(0x6048, 0x604b, 0x604d),
      rightLeg: segment(0x6030, 0x6033, 0x6035, 0x605f), leftLeg: segment(0x6036, 0x6039, 0x603b, 0x605e),
    },
  };
}
