import { googleFetch } from './googleAuth';
import { peopleHeaders, recordHeaders } from '../storage/schema';
import type { Person, SheetRecord } from '../storage/sheetClient';

/**
 * The account's own spreadsheet in Google Drive, reached with the signed-in user's token.
 * Tabs: 人員 (people, plain text), 量測紀錄 (one row per measurement), 設定 (key/value, e.g. the scale identity).
 */
const sheetsApi = 'https://sheets.googleapis.com/v4/spreadsheets';
const driveApi = 'https://www.googleapis.com/drive/v3/files';
const tag = { key: 'rd545', value: 'health' };
const PEOPLE = '人員', RECORDS = '量測紀錄', SETTINGS = '設定';
const settingsHeaders = ['項目', '值'] as const;
const dateColumns = new Set(['量測時間', '寫入時間']);
// Sheets serial dates count days from 1899-12-30 in the spreadsheet's time zone, which we create as Asia/Taipei.
const taipeiMs = 8 * 3600000;
const toSerial = (iso: string) => (Date.parse(iso) + taipeiMs) / 86400000 + 25569;
// Day fractions lose a millisecond to floating point; scale times are whole seconds, so round to the second.
const fromSerial = (serial: number) => new Date(Math.round(((serial - 25569) * 86400000 - taipeiMs) / 1000) * 1000).toISOString();

type Fetch = typeof googleFetch;
export interface Store {
  spreadsheetId: string;
  people: Person[];
  records: SheetRecord[];
  settings: Record<string, string>;
}

const q = (s: string) => encodeURIComponent(s);
const range = (tab: string) => q(`'${tab}'`);

export async function findOrCreate(api: Fetch = googleFetch): Promise<string> {
  const found = await findTagged(api);
  if (found) return found;
  const created = await api<{ spreadsheetId: string; sheets: { properties: { sheetId: number; title: string } }[] }>(sheetsApi, { method: 'POST', body: JSON.stringify({
    properties: { title: 'RD-545 體組成紀錄', timeZone: 'Asia/Taipei', locale: 'zh_TW' },
    sheets: [PEOPLE, RECORDS, SETTINGS].map(title => ({ properties: { title, gridProperties: { frozenRowCount: 1 } } })),
  }) });
  const id = created.spreadsheetId;
  await api(`${sheetsApi}/${id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: [
    { range: `'${PEOPLE}'!A1`, values: [[...peopleHeaders]] }, { range: `'${RECORDS}'!A1`, values: [[...recordHeaders]] }, { range: `'${SETTINGS}'!A1`, values: [[...settingsHeaders]] },
  ] }) });
  // Show the two time columns as dates in Taipei time (values are Sheets serial numbers).
  const recordsSheet = created.sheets.find(x => x.properties.title === RECORDS)!.properties.sheetId;
  await api(`${sheetsApi}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: ['量測時間', '寫入時間'].map(h => recordHeaders.indexOf(h as never)).map(col => ({ repeatCell: {
    range: { sheetId: recordsSheet, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
    cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'yyyy-mm-dd hh:mm:ss' } } }, fields: 'userEnteredFormat.numberFormat' } })) }) });
  // The private tag lets other devices on the same account find this exact file again.
  await api(`${driveApi}/${id}`, { method: 'PATCH', body: JSON.stringify({ appProperties: { [tag.key]: tag.value } }) });
  return id;
}

function toObjects(values: unknown[][] | undefined): Record<string, unknown>[] {
  if (!values?.length) return [];
  const [head, ...rows] = values as string[][];
  return rows.map(row => Object.fromEntries(head.map((h, i) => [h, dateColumns.has(h) && typeof row[i] === 'number' ? fromSerial(row[i] as unknown as number) : row[i] ?? ''])));
}

/**
 * Birth dates may be text ("1990-01-01", "1990/1/1") or, in sheets made by the earlier Apps Script, a real
 * date cell that arrives as a serial day number. Normalise to yyyy-mm-dd so age can be computed.
 */
export function birthDate(v: unknown): string {
  if (typeof v === 'number' && isFinite(v)) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  // The earlier Apps Script saved Taipei midnight as a UTC timestamp (1989-10-24T16:00:00.000Z = 1989-10-25 in Taipei).
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T.+Z$/.test(v.trim()) && !isNaN(Date.parse(v))) return new Date(Date.parse(v) + 8 * 3600000).toISOString().slice(0, 10);
  const m = String(v ?? '').trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : String(v ?? '');
}

export async function load(spreadsheetId: string, api: Fetch = googleFetch): Promise<Store> {
  const ranges = [PEOPLE, RECORDS, SETTINGS].map(t => `ranges=${range(t)}`).join('&');
  const data = await api<{ valueRanges: { values?: unknown[][] }[] }>(`${sheetsApi}/${spreadsheetId}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
  const [people, records, settings] = data.valueRanges.map(v => toObjects(v.values));
  return {
    spreadsheetId,
    people: people.filter(p => p['id']).map(p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, k === '出生日期' ? birthDate(v) : String(v)])) as unknown as Person),
    records: records as SheetRecord[],
    settings: Object.fromEntries(settings.filter(s => s['項目']).map(s => [String(s['項目']), String(s['值'])])),
  };
}

async function append(api: Fetch, id: string, tab: string, rows: unknown[][], input: 'RAW' | 'USER_ENTERED' = 'RAW') {
  await api(`${sheetsApi}/${id}/values/${range(tab)}:append?valueInputOption=${input}&insertDataOption=INSERT_ROWS`, { method: 'POST', body: JSON.stringify({ values: rows }) });
}

export async function savePerson(store: Store, person: Partial<Person>, api: Fetch = googleFetch): Promise<Person> {
  const saved = { ...person, id: person.id || crypto.randomUUID(), 建立時間: person.建立時間 || new Date().toISOString() } as Person;
  const row = peopleHeaders.map(h => String((saved as unknown as Record<string, unknown>)[h] ?? ''));
  const index = store.people.findIndex(p => p.id === saved.id);
  if (index >= 0) {
    await api(`${sheetsApi}/${store.spreadsheetId}/values/${q(`'${PEOPLE}'!A${index + 2}`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [row] }) });
    store.people[index] = saved;
  } else { await append(api, store.spreadsheetId, PEOPLE, [row]); store.people.push(saved); }
  return saved;
}

/** Appends unless a row with the same key exists; dates go in as real date cells so the sheet can chart them. */
export async function saveRecords(store: Store, records: SheetRecord[], api: Fetch = googleFetch): Promise<number> {
  const known = new Set(store.records.map(r => String(r['紀錄鍵'])));
  const fresh = records.filter(r => !known.has(String(r['紀錄鍵'])));
  if (!fresh.length) return 0;
  const now = new Date().toISOString();
  await append(api, store.spreadsheetId, RECORDS, fresh.map(r => recordHeaders.map(h => {
    const v = h === '寫入時間' ? now : r[h];
    return dateColumns.has(h) && typeof v === 'string' ? toSerial(v) : v ?? '';
  })));
  store.records.push(...fresh.map(r => ({ ...r, 寫入時間: now })));
  return fresh.length;
}

export async function saveSetting(store: Store, key: string, value: string, api: Fetch = googleFetch) {
  if (store.settings[key] === value) return;
  if (key in store.settings) {
    const row = Object.keys(store.settings).indexOf(key) + 2;
    await api(`${sheetsApi}/${store.spreadsheetId}/values/${q(`'${SETTINGS}'!A${row}`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [[key, value]] }) });
  } else await append(api, store.spreadsheetId, SETTINGS, [[key, value]]);
  store.settings[key] = value;
}

export const spreadsheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

/** Looks up the account's tagged spreadsheet without creating one. */
export async function findTagged(api: Fetch = googleFetch): Promise<string | null> {
  const query = `appProperties has { key='${tag.key}' and value='${tag.value}' } and trashed=false`;
  const found = await api<{ files: { id: string }[] }>(`${driveApi}?q=${q(query)}&fields=files(id)&spaces=drive`);
  return found.files[0]?.id ?? null;
}

/**
 * Uses a spreadsheet the user picked (e.g. the one they already had). Existing rows are never changed:
 * only a missing tab is added with its header row, then the file is tagged so every device finds it.
 */
export async function adopt(id: string, api: Fetch = googleFetch): Promise<string> {
  const meta = await api<{ sheets: { properties: { title: string } }[] }>(`${sheetsApi}/${id}?fields=sheets.properties.title`);
  const have = new Set(meta.sheets.map(s => s.properties.title));
  const missing = ([[PEOPLE, peopleHeaders], [RECORDS, recordHeaders], [SETTINGS, settingsHeaders]] as const).filter(([title]) => !have.has(title));
  if (missing.length) {
    await api(`${sheetsApi}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: missing.map(([title]) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) }) });
    await api(`${sheetsApi}/${id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: missing.map(([title, headers]) => ({ range: `'${title}'!A1`, values: [[...headers]] })) }) });
  }
  await api(`${driveApi}/${id}`, { method: 'PATCH', body: JSON.stringify({ appProperties: { [tag.key]: tag.value } }) });
  return id;
}

/** Stops the app from finding a spreadsheet again (the file itself is left in Drive). */
export async function untag(id: string, api: Fetch = googleFetch) {
  await api(`${driveApi}/${id}`, { method: 'PATCH', body: JSON.stringify({ appProperties: { [tag.key]: null } }) });
}

/** Row number (1-based, header = 1) of a measurement, read fresh so a concurrent edit cannot make us touch the wrong row. */
async function recordRow(store: Store, key: string, api: Fetch): Promise<number> {
  const data = await api<{ values?: string[][] }>(`${sheetsApi}/${store.spreadsheetId}/values/${q(`'${RECORDS}'!A:A`)}`);
  const index = (data.values ?? []).findIndex(row => row[0] === key);
  if (index < 1) throw Error('在試算表裡找不到這筆紀錄，可能已被刪除，請按「重新整理」');
  return index + 1;
}

/** Deletes one measurement row from the 量測紀錄 tab. */
export async function deleteRecord(store: Store, key: string, api: Fetch = googleFetch) {
  const row = await recordRow(store, key, api);
  const meta = await api<{ sheets: { properties: { sheetId: number; title: string } }[] }>(`${sheetsApi}/${store.spreadsheetId}?fields=sheets.properties(sheetId,title)`);
  const sheetId = meta.sheets.find(s => s.properties.title === RECORDS)!.properties.sheetId;
  await api(`${sheetsApi}/${store.spreadsheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } } }] }) });
  store.records = store.records.filter(r => String(r['紀錄鍵']) !== key);
}

/** Moves a measurement to another person (when the wrong person was selected while measuring). */
export async function moveRecord(store: Store, key: string, person: Person, api: Fetch = googleFetch) {
  const record = store.records.find(r => String(r['紀錄鍵']) === key);
  if (!record) throw Error('找不到這筆紀錄，請按「重新整理」');
  const newKey = `${new Date(String(record['量測時間'])).toISOString()}|${person.id}`;
  if (store.records.some(r => String(r['紀錄鍵']) === newKey)) throw Error(`${person.姓名} 已經有同一時間的紀錄`);
  const row = await recordRow(store, key, api);
  const column = (header: string) => { const i = recordHeaders.indexOf(header as never); return String.fromCharCode(65 + i); };
  const changes: [string, string][] = [['紀錄鍵', newKey], ['人員id', person.id], ['群組', person.群組], ['姓名', person.姓名]];
  await api(`${sheetsApi}/${store.spreadsheetId}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW',
    data: changes.map(([h, v]) => ({ range: `'${RECORDS}'!${column(h)}${row}`, values: [[v]] })) }) });
  Object.assign(record, Object.fromEntries(changes));
}
