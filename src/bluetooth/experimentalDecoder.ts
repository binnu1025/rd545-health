/** Offline, single-layout research decoder. Never issues BLE commands. */
import { decodeBodyComposition } from './bodyComposition';
export const experimentalNotice = '實驗性解碼：已與兩次實機畫面核對（本人模式），Guest／多人尚未驗證';
export function validateFrame(frame: Uint8Array): void {
  if (frame.length < 5 || frame.length > 4096) throw Error('訊息長度超出範圍');
  if ((frame[0] * 256 + frame[1]) !== frame.length - 2) throw Error('訊息長度不符');
  if ((frame.reduce((sum, byte) => sum + byte, 0) & 255) !== 255) throw Error('校驗失敗');
}
export class ExperimentalAssembler {
  private chunks: number[] = [];
  private next = 0;
  private last = -1;
  reset() { this.chunks = []; this.next = 0; this.last = -1; }
  push(fragment: Uint8Array): Uint8Array | null {
    try {
      if (fragment.length < 5 || fragment.length > 20) throw Error('分段長度不符');
      const offset = fragment[0] * 256 + fragment[1], last = fragment[2], size = fragment[3];
      if (offset % 16 || offset / 16 > last || size < 1 || size > 16 || fragment.length < size + 4 || (offset / 16 < last && size !== 16)) throw Error('分段標頭不符');
      if (offset === 0) {
        if (this.last !== -1) throw Error('上一訊息尚未完成');
        this.last = last;
      }
      if (this.last !== last || offset !== this.next) throw Error('分段遺失、重複或順序錯誤');
      if (fragment.subarray(size + 4).some(b => b !== 0)) throw Error('非零補齊資料');
      this.chunks.push(...fragment.subarray(4, size + 4)); this.next += 16;
      if (offset / 16 !== last) return null;
      const frame = Uint8Array.from(this.chunks); this.reset(); validateFrame(frame); return frame;
    } catch (error) { this.reset(); throw error; }
  }
}
// Positions and tags are candidate mappings in the observed 346-byte b010 layout.
// Exact layout checks deliberately reject other layouts instead of scanning for tags.
export const candidateFields = [
  { key: 'weightKg', label: '體重', offset: 25, tag: 0x6021, width: 2, scale: 100, unit: 'kg' },
  { key: 'bodyFatPct', label: '體脂率', offset: 33, tag: 0x6022, width: 2, scale: 10, unit: '%' },
  { key: 'muscleMassKg', label: '肌肉量', offset: 60, tag: 0x6023, width: 2, scale: 100, unit: 'kg' },
  { key: 'visceralFatLevel', label: '內臟脂肪等級', offset: 156, tag: 0x6025, width: 2, scale: 10, unit: '等級' },
  { key: 'muscleQualityScore', label: '肌肉品質', offset: 167, tag: 0x605b, width: 1, scale: 1, unit: '分' },
] as const;
// Official parser: 6a32 = days since 2000-01-01, 6a33 = half-seconds of the day, in the scale's (Taipei) clock.
const dateTagOffset = 6, timeTagOffset = 10, taipeiOffsetMs = 8 * 3600000;
export function decodeExperimentalResult(frame: Uint8Array) {
  validateFrame(frame);
  if (frame.length !== 346 || frame[2] !== 0xb0 || frame[3] !== 0x10) throw Error('不是已觀察的結果訊息格式');
  if (frame[dateTagOffset] * 256 + frame[dateTagOffset + 1] !== 0x6a32 || frame[timeTagOffset] * 256 + frame[timeTagOffset + 1] !== 0x6a33) throw Error('量測時間欄位位置不符；拒絕猜測數值');
  const days = frame[dateTagOffset + 2] * 256 + frame[dateTagOffset + 3];
  const halfSeconds = frame[timeTagOffset + 2] * 65536 + frame[timeTagOffset + 3] * 256 + frame[timeTagOffset + 4];
  if (halfSeconds >= 172800) throw Error('量測時間超出範圍');
  const measuredAt = new Date(Date.UTC(2000, 0, 1) + days * 86400000 + halfSeconds * 500 - taipeiOffsetMs);
  const metrics = candidateFields.map(field => {
    const {offset, width, scale, tag} = field;
    if (frame[offset] * 256 + frame[offset + 1] !== tag) throw Error('欄位位置不符；拒絕猜測數值');
    const raw = width === 1 ? frame[offset + 2] : frame[offset + 2] * 256 + frame[offset + 3];
    return { ...field, raw, value: raw / scale, verification: 'SINGLE_SAMPLE_CANDIDATE' as const };
  });
  return { status: 'EXPERIMENTAL' as const, notice: experimentalNotice, measuredAt, metrics, detail: decodeBodyComposition(frame) };
}
