import type { BodyComposition } from '../bluetooth/bodyComposition';

/**
 * Shared row types and the row <-> body-composition mapping. The Apps Script connection below is kept only to
 * import data from the spreadsheet the app used before Google sign-in.
 */
export interface SheetConfig { url: string; token: string }
export interface Person { id: string; 群組: string; 姓名: string; 性別: 'male' | 'female'; 出生日期: string; 身高cm: string; 體脂計本人: string; 建立時間?: string }
export type SheetRecord = Record<string, string | number | null>;

const configKey = 'rd545.sheet', selectedKey = 'rd545.selectedPerson';
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage blocked: settings last for this visit only */ } };

export function loadConfig(): SheetConfig | null {
  try { const c = JSON.parse(read(configKey) ?? 'null'); return c && typeof c.url === 'string' && typeof c.token === 'string' ? c : null; } catch { return null; }
}
export const saveConfig = (config: SheetConfig | null) => write(configKey, config && JSON.stringify(config));
export const loadSelectedPerson = () => read(selectedKey);
export const saveSelectedPerson = (id: string | null) => write(selectedKey, id);

async function call<T>(config: SheetConfig, action: string, payload: object = {}): Promise<T> {
  // text/plain keeps this a "simple" request, which Apps Script web apps accept cross-origin without a preflight.
  const response = await fetch(config.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: config.token, action, ...payload }) });
  if (!response.ok) throw Error(`Google 試算表回應 ${response.status}`);
  const data = await response.json().catch(() => { throw Error('Google 試算表回應不是 JSON：請確認部署的「誰可以存取」為「所有人」'); });
  if (!data.ok) throw Error(`Google 試算表：${data.error ?? '未知錯誤'}`);
  return data as T;
}

export const listAll = (c: SheetConfig) => call<{ people: Person[]; records: SheetRecord[] }>(c, 'list');

/** Rebuilds a saved row for the report, so the latest result shows without touching the scale. */
export function fromRecord(r: SheetRecord): { measuredAt: Date; detail: BodyComposition } | null {
  const at = new Date(String(r['量測時間'] ?? ''));
  if (isNaN(+at)) return null;
  const n = (key: string) => { const v = r[key]; return typeof v === 'number' && isFinite(v) ? v : null; };
  const seg = (name: string, quality = true) => ({ muscleKg: n(`${name}肌肉kg`), fatPct: n(`${name}體脂%`), muscleScore: n(`${name}肌肉評分`), muscleQuality: quality ? n(`${name}肌肉品質`) : null });
  return { measuredAt: at, detail: {
    heightCm: n('身高cm'), weightKg: n('體重kg'), bmi: n('BMI'), bodyFatPct: n('體脂率%'), muscleMassKg: n('肌肉量kg'), muscleScore: n('肌肉評分'),
    boneMassKg: n('骨量kg'), bmrKcal: n('基礎代謝kcal'), metabolicAge: n('代謝年齡'), visceralFat: n('內臟脂肪'), bodyWaterPct: n('體水分率%'), muscleQuality: n('肌肉品質'),
    segments: { rightArm: seg('右手'), leftArm: seg('左手'), trunk: seg('軀幹', false), rightLeg: seg('右腳'), leftLeg: seg('左腳') },
  } };
}

/** One spreadsheet row per measurement; the key makes re-reading the same stored result a no-op. */
export function toRecord(person: Person, measuredAt: Date, d: BodyComposition): SheetRecord {
  const s = d.segments;
  const seg = (name: string, x: typeof s.rightArm, quality = true) => ({
    [`${name}肌肉kg`]: x.muscleKg, [`${name}體脂%`]: x.fatPct, [`${name}肌肉評分`]: x.muscleScore, ...(quality ? { [`${name}肌肉品質`]: x.muscleQuality } : {}) });
  return {
    紀錄鍵: `${measuredAt.toISOString()}|${person.id}`, 量測時間: measuredAt.toISOString(), 人員id: person.id, 群組: person.群組, 姓名: person.姓名,
    體重kg: d.weightKg, BMI: d.bmi, '體脂率%': d.bodyFatPct, 肌肉量kg: d.muscleMassKg, 肌肉評分: d.muscleScore, 骨量kg: d.boneMassKg,
    '體水分率%': d.bodyWaterPct, 內臟脂肪: d.visceralFat, 基礎代謝kcal: d.bmrKcal, 代謝年齡: d.metabolicAge, 肌肉品質: d.muscleQuality, 身高cm: d.heightCm,
    ...seg('右手', s.rightArm), ...seg('左手', s.leftArm), ...seg('軀幹', s.trunk, false), ...seg('右腳', s.rightLeg), ...seg('左腳', s.leftLeg),
  };
}
