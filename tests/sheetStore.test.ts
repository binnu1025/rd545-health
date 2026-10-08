import { expect, it } from 'vitest';
import { findOrCreate, load, savePerson, saveRecords, saveSetting } from '../src/google/sheetStore';
import { recordHeaders } from '../src/storage/schema';
import { fromRecord, toRecord, type Person } from '../src/storage/sheetClient';
import type { BodyComposition } from '../src/bluetooth/bodyComposition';

// In-memory stand-in for the Drive and Sheets REST endpoints the store calls.
function fakeGoogle(existing = false) {
  const tabs = new Map<string, unknown[][]>(), calls: string[] = [], patched: unknown[] = [];
  let tagged = existing;
  if (existing) for (const t of ['人員', '量測紀錄', '設定']) tabs.set(t, []);
  const tabOf = (u: string) => decodeURIComponent(u).match(/'([^']+)'/)![1];
  const api = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push(`${method} ${url.split('?')[0].replace('https://', '')}`);
    if (url.includes('drive/v3/files?')) return { files: tagged ? [{ id: 's1' }] : [] };
    if (method === 'GET' && url.includes('?fields=sheets.properties.title')) return { sheets: [...tabs.keys()].map(title => ({ properties: { title } })) };
    if (method === 'PATCH') { tagged = body.appProperties.rd545 === 'health'; patched.push(body.appProperties.rd545); return {}; }
    if (method === 'POST' && url.endsWith('/v4/spreadsheets')) {
      body.sheets.forEach((s: { properties: { title: string } }) => tabs.set(s.properties.title, []));
      return { spreadsheetId: 's1', sheets: body.sheets.map((s: { properties: { title: string } }, i: number) => ({ properties: { sheetId: i, title: s.properties.title } })) };
    }
    if (url.includes('values:batchUpdate')) { for (const d of body.data) tabs.get(tabOf(d.range))!.splice(0, 1, d.values[0]); return {}; }
    if (url.endsWith(':batchUpdate')) { for (const r of body.requests) if (r.addSheet) tabs.set(r.addSheet.properties.title, []); return {}; }
    if (url.includes('values:batchGet')) return { valueRanges: [...url.matchAll(/ranges=([^&]+)/g)].map(m => ({ values: tabs.get(tabOf(m[1])) })) };
    if (url.includes(':append')) { tabs.get(tabOf(url))!.push(...body.values); return {}; }
    if (method === 'PUT') { const row = Number(decodeURIComponent(url).match(/!A(\d+)/)![1]); tabs.get(tabOf(url))![row - 1] = body.values[0]; return {}; }
    throw Error(`unexpected ${method} ${url}`);
  }) as <T>(url: string, init?: RequestInit) => Promise<T>;
  return { api, tabs, calls, patched, untagged: () => !tagged };
}
const detail: BodyComposition = { heightCm: 170, weightKg: 70, bmi: 24.2, bodyFatPct: 20, muscleMassKg: 52, muscleScore: 1, boneMassKg: 2.9, bmrKcal: 1600,
  metabolicAge: 35, visceralFat: 8, bodyWaterPct: 55, muscleQuality: 60,
  segments: Object.fromEntries(['rightArm', 'leftArm', 'trunk', 'rightLeg', 'leftLeg'].map(k => [k, { fatPct: 18, muscleKg: 3, muscleScore: 0, muscleQuality: 70 }])) as BodyComposition['segments'] };
const owner = { 群組: '家人', 姓名: '測試', 性別: 'male' as const, 出生日期: '1990-01-01', 身高cm: '170', 體脂計本人: 'true' };

it('creates the spreadsheet once, tags it, and finds the same file next time', async () => {
  const g = fakeGoogle();
  expect(await findOrCreate(g.api)).toBe('s1');
  expect(g.tabs.get('量測紀錄')![0]).toEqual([...recordHeaders]);
  expect(g.calls.some(c => c.startsWith('PATCH'))).toBe(true);
  g.calls.length = 0;
  expect(await findOrCreate(g.api)).toBe('s1');
  expect(g.calls.every(c => c.startsWith('GET'))).toBe(true); // found by tag, nothing created
});
it('saves people, settings and measurements, skipping a measurement already stored', async () => {
  const g = fakeGoogle();
  const store = await load(await findOrCreate(g.api), g.api);
  const person = await savePerson(store, owner, g.api);
  await savePerson(store, { ...person, 身高cm: '171' }, g.api); // update in place, not a second row
  expect(g.tabs.get('人員')).toHaveLength(2);
  await saveSetting(store, '體脂計身分', 'uuid-1', g.api);
  const at = new Date('2026-02-03T04:05:06Z');
  expect(await saveRecords(store, [toRecord(person, at, detail)], g.api)).toBe(1);
  expect(await saveRecords(store, [toRecord(person, at, detail)], g.api)).toBe(0);
  // Dates are stored as Sheets serial numbers in Taipei time: 2026-02-03 12:05:06.
  const timeCell = g.tabs.get('量測紀錄')![1][recordHeaders.indexOf('量測時間')] as number;
  expect(timeCell).toBeCloseTo(46056 + (12 * 3600 + 5 * 60 + 6) / 86400, 6);
  // Another device loading the same file sees everything, with dates back as ISO.
  const again = await load('s1', g.api);
  expect(again.people[0].身高cm).toBe('171');
  expect(again.settings['體脂計身分']).toBe('uuid-1');
  expect(fromRecord(again.records[0])!.measuredAt.toISOString()).toBe(at.toISOString());
  expect(fromRecord(again.records[0])!.detail.weightKg).toBe(70);
});
it('fills every sheet column from a measurement (no misspelled keys)', () => {
  const record = toRecord({ ...owner, id: 'x' } as Person, new Date(), detail);
  expect(Object.keys(record).sort()).toEqual(recordHeaders.filter(h => h !== '寫入時間').sort());
});
it('rebuilds a saved row into the same body composition for the report', () => {
  const at = new Date('2026-02-03T04:05:06Z');
  const back = fromRecord(toRecord({ ...owner, id: 'x' } as Person, at, detail))!;
  expect(back.measuredAt.toISOString()).toBe(at.toISOString());
  expect(back.detail).toEqual({ ...detail, segments: { ...detail.segments, trunk: { ...detail.segments.trunk, muscleQuality: null } } });
  expect(fromRecord({ 量測時間: 'not a date' })).toBeNull();
});
it('adopts a spreadsheet the user already had without touching its rows', async () => {
  const { adopt, untag } = await import('../src/google/sheetStore');
  const g = fakeGoogle();
  const existingPerson = ['p1', '家人', '我', 'male', '1990-01-01', '174', 'true', ''];
  g.tabs.set('人員', [['id', '群組', '姓名', '性別', '出生日期', '身高cm', '體脂計本人', '建立時間'], existingPerson]);
  g.tabs.set('量測紀錄', [[...recordHeaders], ['k', 46000]]);
  await adopt('s1', g.api);
  expect([...g.tabs.keys()]).toEqual(['人員', '量測紀錄', '設定']);          // only the missing tab added
  expect(g.tabs.get('人員')![1]).toEqual(existingPerson);                      // rows untouched
  expect(g.tabs.get('量測紀錄')).toHaveLength(2);
  expect(g.patched).toEqual(['health']);                                   // tagged for other devices
  await untag('old-empty', g.api);
  expect(g.patched).toEqual(['health', null]);
});
it('reads birth dates stored as text or as a Sheets date number', async () => {
  const { birthDate } = await import('../src/google/sheetStore');
  expect(birthDate(32878)).toBe('1990-01-05');       // date cell from the earlier Apps Script sheet
  expect(birthDate('1990/1/5')).toBe('1990-01-05');
  expect(birthDate('1990-01-05')).toBe('1990-01-05');
  expect(birthDate('')).toBe('');
});
