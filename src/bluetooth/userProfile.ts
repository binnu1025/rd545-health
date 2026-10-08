/**
 * Reads sex / birth date / height from the scale's own profile (0x1000 reply, 0x9000).
 * Layout per official jp/co/tanita/comm/ble/TNTUserInformation.java: 6a37 gender (0 male, 1 female),
 * 6a3c birth = days since 1900-01-01 plus one, 6a3e height ×10, 7e22 length-prefixed nickname (skipped, never kept).
 */
export interface ScaleProfile { sex: 'male' | 'female'; birthDate: Date; heightCm: number }
const fixedSizes: Record<number, number> = { 0x6a32: 2, 0x6a33: 3, 0x6a3c: 2, 0x6a37: 1, 0x6a38: 1, 0x6a3e: 2, 0x6a3b: 1, 0x604f: 2, 0x6a13: 1, 0x6a15: 4 };

export function decodeScaleProfile(frame: Uint8Array): ScaleProfile | null {
  if (frame.length < 7 || frame[2] !== 0x90 || frame[3] !== 0x00 || frame[4] !== 0) return null;
  const values = new Map<number, number>();
  let i = 5;
  while (i < frame.length - 1) {
    const tag = frame[i] * 256 + frame[i + 1];
    // 7e22 (32290) carries its own length byte, like the official 0x7e21–0x7eff skip rule.
    const size = tag === 0x7e22 ? 1 + frame[i + 2] : fixedSizes[tag];
    if (!size || i + 2 + size > frame.length - 1) return null;
    if (tag !== 0x7e22) { let v = 0; for (let k = 0; k < size; k++) v = v * 256 + frame[i + 2 + k]; values.set(tag, v); }
    i += 2 + size;
  }
  if (i !== frame.length - 1) return null;
  const gender = values.get(0x6a37), birth = values.get(0x6a3c), height = values.get(0x6a3e);
  if ((gender !== 0 && gender !== 1) || !birth || !height) return null;
  return { sex: gender === 0 ? 'male' : 'female', birthDate: new Date(Date.UTC(1900, 0, 1) + (birth - 1) * 86400000), heightCm: height / 10 };
}

/** Whole years between birth and the measurement, by calendar date in Taipei. */
export function ageAt(birthDate: Date, at: Date): number {
  const taipei = new Date(at.getTime() + 8 * 3600000);
  let age = taipei.getUTCFullYear() - birthDate.getUTCFullYear();
  if (taipei.getUTCMonth() < birthDate.getUTCMonth() || (taipei.getUTCMonth() === birthDate.getUTCMonth() && taipei.getUTCDate() < birthDate.getUTCDate())) age--;
  return age;
}
