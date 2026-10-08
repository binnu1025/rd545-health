/**
 * Google Apps Script the user pastes into their own spreadsheet (Extensions → Apps Script).
 * The page fills in a random token; every request must carry it, because a deployed web app URL is
 * reachable by anyone who has it. Plain JS without template literals so it pastes cleanly.
 */
export const peopleHeaders = ['id', '群組', '姓名', '性別', '出生日期', '身高cm', '體脂計本人', '建立時間'] as const;
export const recordHeaders = ['紀錄鍵', '量測時間', '人員id', '群組', '姓名', '體重kg', 'BMI', '體脂率%', '肌肉量kg', '肌肉評分', '骨量kg',
  '體水分率%', '內臟脂肪', '基礎代謝kcal', '代謝年齡', '肌肉品質', '身高cm',
  '右手肌肉kg', '右手體脂%', '右手肌肉評分', '右手肌肉品質', '左手肌肉kg', '左手體脂%', '左手肌肉評分', '左手肌肉品質',
  '軀幹肌肉kg', '軀幹體脂%', '軀幹肌肉評分', '右腳肌肉kg', '右腳體脂%', '右腳肌肉評分', '右腳肌肉品質',
  '左腳肌肉kg', '左腳體脂%', '左腳肌肉評分', '左腳肌肉品質', '寫入時間'] as const;

export function buildAppsScript(token: string): string {
  return `// RD-545 體組成紀錄：由網頁產生。請勿把這段程式或網址分享給別人。
var TOKEN = '${token}';
var PEOPLE = '人員', RECORDS = '量測紀錄';
var PEOPLE_HEADERS = ${JSON.stringify(peopleHeaders)};
var RECORD_HEADERS = ${JSON.stringify(recordHeaders)};

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: '請求格式錯誤' }); }
  if (!body || body.token !== TOKEN) return out({ ok: false, error: '密鑰不符' });
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (body.action === 'list') {
      return out({ ok: true, people: rows(sheet(PEOPLE, PEOPLE_HEADERS, true)), records: rows(sheet(RECORDS, RECORD_HEADERS, false)).slice(-500) });
    }
    if (body.action === 'savePerson') {
      var p = body.person, sh = sheet(PEOPLE, PEOPLE_HEADERS, true);
      if (!p || !p['姓名'] || !p['群組']) return out({ ok: false, error: '群組與姓名必填' });
      p['id'] = p['id'] || Utilities.getUuid();
      if (!p['建立時間']) p['建立時間'] = new Date().toISOString();
      var found = findRow(sh, 'id', p['id']);
      var values = [PEOPLE_HEADERS.map(function (h) { return p[h] === undefined ? '' : String(p[h]); })];
      if (found) sh.getRange(found, 1, 1, PEOPLE_HEADERS.length).setValues(values); else sh.appendRow(values[0]);
      return out({ ok: true, person: p });
    }
    if (body.action === 'saveRecord') {
      var r = body.record, rs = sheet(RECORDS, RECORD_HEADERS, false);
      if (!r || !r['紀錄鍵'] || !r['量測時間']) return out({ ok: false, error: '紀錄不完整' });
      if (findRow(rs, '紀錄鍵', r['紀錄鍵'])) return out({ ok: true, duplicate: true });
      r['寫入時間'] = new Date();
      r['量測時間'] = new Date(r['量測時間']);
      rs.appendRow(RECORD_HEADERS.map(function (h) { return r[h] === undefined || r[h] === null ? '' : r[h]; }));
      return out({ ok: true, duplicate: false });
    }
    return out({ ok: false, error: '不支援的動作' });
  } finally {
    lock.releaseLock();
  }
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function sheet(name, headers, plainText) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    ss.setSpreadsheetTimeZone('Asia/Taipei');
    sh = ss.insertSheet(name);
    // Text format keeps birth dates and ids exactly as typed instead of turning them into dates.
    if (plainText) sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function rows(sh) {
  var v = sh.getDataRange().getValues(), h = v.shift();
  return v.map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = r[i]; }); return o; });
}

function findRow(sh, header, value) {
  var v = sh.getDataRange().getValues(), col = v[0].indexOf(header);
  for (var i = 1; i < v.length; i++) if (String(v[i][col]) === String(value)) return i + 1;
  return 0;
}
`;
}
