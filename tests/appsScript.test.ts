import { expect, it } from 'vitest';
import { buildAppsScript, recordHeaders } from '../src/storage/appsScript';
import { toRecord, type Person } from '../src/storage/sheetClient';
import type { BodyComposition } from '../src/bluetooth/bodyComposition';

// Minimal in-memory stand-ins for the Apps Script services the generated script uses.
function runtime() {
  const sheets = new Map<string, unknown[][]>();
  const sheetApi = (name: string) => {
    const data = sheets.get(name)!;
    return {
      appendRow: (row: unknown[]) => { data.push(row); },
      setFrozenRows: () => {},
      getMaxRows: () => 1000,
      getRange: (r: number, _c: number, _n: number, w: number) => ({ setNumberFormat: () => {}, setValues: (v: unknown[][]) => { data[r - 1] = v[0].slice(0, w); } }),
      getDataRange: () => ({ getValues: () => data.map(row => row.slice()) }),
    };
  };
  const env = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n: string) => sheets.has(n) ? sheetApi(n) : null, insertSheet: (n: string) => { sheets.set(n, []); return sheetApi(n); }, setSpreadsheetTimeZone: () => {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text: string) => ({ setMimeType: () => ({ text }) }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: { getUuid: () => 'person-1' },
  };
  const doPost = new Function(...Object.keys(env), `${buildAppsScript('secret-token')}; return doPost;`)(...Object.values(env));
  const post = (body: object) => JSON.parse(doPost({ postData: { contents: JSON.stringify(body) } }).text);
  return { post, sheets };
}
const detail: BodyComposition = { heightCm: 170, weightKg: 70, bmi: 24.2, bodyFatPct: 20, muscleMassKg: 52, muscleScore: 1, boneMassKg: 2.9, bmrKcal: 1600,
  metabolicAge: 35, visceralFat: 8, bodyWaterPct: 55, muscleQuality: 60,
  segments: Object.fromEntries(['rightArm', 'leftArm', 'trunk', 'rightLeg', 'leftLeg'].map(k => [k, { fatPct: 18, muscleKg: 3, muscleScore: 0, muscleQuality: 70 }])) as BodyComposition['segments'] };

it('rejects requests without the token', () => {
  expect(runtime().post({ token: 'wrong', action: 'list' })).toEqual({ ok: false, error: '密鑰不符' });
});
it('saves a person and a measurement once, keyed by measurement time and person', () => {
  const { post, sheets } = runtime();
  const person = post({ token: 'secret-token', action: 'savePerson', person: { 群組: '家人', 姓名: '測試', 性別: 'male', 出生日期: '1990-01-01', 身高cm: '170', 體脂計本人: 'true' } }).person as Person;
  expect(person.id).toBe('person-1');
  const record = toRecord(person, new Date('2026-01-01T00:00:00Z'), detail);
  expect(post({ token: 'secret-token', action: 'saveRecord', record })).toEqual({ ok: true, duplicate: false });
  expect(post({ token: 'secret-token', action: 'saveRecord', record })).toEqual({ ok: true, duplicate: true });
  const rows = sheets.get('量測紀錄')!;
  expect(rows).toHaveLength(2);
  expect(rows[1][recordHeaders.indexOf('體重kg')]).toBe(70);
  expect(rows[1][recordHeaders.indexOf('左腳肌肉品質')]).toBe(70);
  const listed = post({ token: 'secret-token', action: 'list' });
  expect(listed.people[0].姓名).toBe('測試');
});
it('fills every sheet column from a measurement (no misspelled keys)', () => {
  const record = toRecord({ id: 'x', 群組: 'g', 姓名: 'n', 性別: 'male', 出生日期: '', 身高cm: '', 體脂計本人: 'true' }, new Date(), detail);
  expect(Object.keys(record).sort()).toEqual(recordHeaders.filter(h => h !== '寫入時間').sort());
});
