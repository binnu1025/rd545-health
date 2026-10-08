/**
 * Builds the 0x1002 "exchange user information" payload the way the official app does
 * (jp/co/tanita/comm/ble/TNTBLEPeripheral.saveUserInformation, user number 0 = the person this app is
 * registered as). Only birth date, sex and height are ever changed; every other field is copied byte for byte
 * from the scale's own 0x9000 reply, so writing the owner's original reply back restores it exactly.
 */
import { encodeTaipeiClock } from './identityProbe';

export interface BodyProfile { birthDate: string; sex: 'male' | 'female'; heightCm: number }
type Tags = Map<number, Uint8Array>;

const fixed: Record<number, number> = { 0x6a32: 2, 0x6a33: 3, 0x6a3c: 2, 0x6a37: 1, 0x6a38: 1, 0x6a3e: 2, 0x6a3b: 1, 0x604f: 2, 0x6a13: 1, 0x6a15: 4, 0x6a3d: 5 };

/** Tag values of a 0x9000 / 0x9002 reply (status 0). Length-prefixed 0x7exx tags keep their length byte. */
export function profileTags(frame: Uint8Array): Tags {
  const command = frame[2] * 256 + frame[3];
  if ((command !== 0x9000 && command !== 0x9002) || frame[4] !== 0) throw Error('不是體脂計個人資料回覆');
  const tags: Tags = new Map();
  let i = 5;
  while (i < frame.length - 1) {
    const tag = frame[i] * 256 + frame[i + 1];
    const size = tag >= 0x7e21 && tag <= 0x7eff ? 1 + frame[i + 2] : fixed[tag];
    if (!size || i + 2 + size > frame.length - 1) throw Error('個人資料格式不符，已停止');
    tags.set(tag, frame.slice(i + 2, i + 2 + size)); i += 2 + size;
  }
  for (const t of [0x6a3c, 0x6a37, 0x6a38, 0x6a3e, 0x6a3b, 0x604f, 0x6a15, 0x7e22]) if (!tags.has(t)) throw Error('個人資料缺少欄位，已停止');
  return tags;
}

/** Days since 1900-01-01 plus one, as the official TNT code stores birth dates. */
export function birthCount(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) throw Error('生日格式不正確');
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 1)) / 86400000) + 1;
}

const u16 = (v: number) => [v >> 8 & 255, v & 255];

/** Payload for 0x1002: the owner's fields, with birth date / sex / height replaced when `person` is given. */
export function userInfoPayload(owner: Tags, person: BodyProfile | null, now: Date): Uint8Array {
  const nickname = owner.get(0x7e22)!; // [length, ...bytes]
  const out: number[] = [0x00, ...encodeTaipeiClock(now)];
  out.push(0x6a, 0x3d, ...Array.from({ length: 5 }, (_, k) => nickname[1 + k] ?? 0));
  out.push(0x7e, 0x22, ...nickname);
  const height = person ? Math.round(person.heightCm * 10) : null;
  if (height !== null && (height < 900 || height > 2499)) throw Error('身高超出體脂計可接受範圍（90～249.9 cm）');
  out.push(0x6a, 0x3c, ...(person ? u16(birthCount(person.birthDate)) : owner.get(0x6a3c)!));
  out.push(0x6a, 0x37, ...(person ? [person.sex === 'male' ? 0 : 1] : owner.get(0x6a37)!));
  out.push(0x6a, 0x38, ...owner.get(0x6a38)!);
  out.push(0x6a, 0x3e, ...(height !== null ? u16(height) : owner.get(0x6a3e)!));
  out.push(0x6a, 0x3b, ...owner.get(0x6a3b)!);
  out.push(0x60, 0x4f, ...owner.get(0x604f)!);
  out.push(0x6a, 0x15, ...owner.get(0x6a15)!);
  // The official app sends region 0xfe and protocol 0 here; the scale keeps its own region.
  out.push(0x6a, 0x13, 0xfe, 0x7e, 0x2f, 0x01, 0x00);
  return Uint8Array.from(out);
}

/** Checks the scale's 0x9002 echo stored exactly the birth date, sex and height we sent. */
export function echoMatches(echo: Uint8Array, expected: Tags | BodyProfile): boolean {
  const got = profileTags(echo);
  const same = (a: Uint8Array | undefined, b: number[] | Uint8Array) => !!a && a.length === b.length && a.every((v, k) => v === b[k]);
  if (expected instanceof Map) return [0x6a3c, 0x6a37, 0x6a3e].every(t => same(got.get(t), expected.get(t)!));
  return same(got.get(0x6a3c), u16(birthCount(expected.birthDate))) && same(got.get(0x6a37), [expected.sex === 'male' ? 0 : 1])
    && same(got.get(0x6a3e), u16(Math.round(expected.heightCm * 10)));
}
