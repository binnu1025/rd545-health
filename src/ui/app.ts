import type { BleProbe } from '../bluetooth/BleProbe';
import { observedServiceUuid } from '../bluetooth/autoReceive';
import { identifyScale, type ScaleStage } from '../bluetooth/identityProbe';
import { ageAt, type ScaleProfile } from '../bluetooth/userProfile';
import { isSignedIn, NeedsSignIn, pickSpreadsheet, prepareGoogle, rememberedEmail, signedInEmail, signIn, signOut } from '../google/googleAuth';
import { adopt, deleteRecord, findOrCreate, load, moveRecord, savePerson, saveRecords, saveSetting, spreadsheetUrl, untag, type Store } from '../google/sheetStore';
import { fromRecord, loadSelectedPerson, saveSelectedPerson, toRecord, type Person } from '../storage/sheetClient';
import { renderBodyComposition, type ReportProfile } from './bodyFigure';
import { renderTrend } from './trendChart';
import { exportReport } from '../report/report';

/**
 * The whole everyday screen as one guided flow:
 * sign in → connect the scale (identity) → "is this you?" (owner from the scale's own profile) → home
 * (pick a person, one "開始量測" button, latest result, trend).
 */
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const hasBluetooth = typeof navigator !== 'undefined' && !!navigator.bluetooth;
const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const familyConsentKey = 'rd545.familyConsent';
const scaleNamePrefix = 'TNT_BW', identityKey = '體脂計身分', deviceIdentityKey = 'rd545.identity';
const sheetIdKey = (email: string) => `rd545.sheetId.${email}`;
const local = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* visit-only */ } } };
const isOwner = (p: Person | null | undefined) => p?.體脂計本人 === 'true';
const missing = (p: Partial<Person>) => [!p.姓名?.trim() && '姓名', p.性別 !== 'male' && p.性別 !== 'female' && '性別', !/^\d{4}-\d{2}-\d{2}$/.test(p.出生日期 ?? '') && '生日', !(Number(p.身高cm) > 0) && '身高'].filter((x): x is string => !!x);
const complete = (p: Partial<Person>) => missing(p).length === 0;
const taipeiTime = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};
const stages: { key: ScaleStage | 'connect' | 'save'; label: string }[] = [
  { key: 'connect', label: '連線體脂計' }, { key: 'verify', label: '確認身分' }, { key: 'stand', label: '請赤腳站上體脂計' }, { key: 'read', label: '讀取結果' }, { key: 'save', label: '存檔' },
];

type Run = (op: () => Promise<void>, success: string) => Promise<void>;
export function mountApp(root: HTMLElement, probe: BleProbe, run: Run) {
  const section = document.createElement('section');
  section.className = 'card app';
  root.prepend(section);
  let store: Store | null = null, needIdentity = false, uuid = '', selectedId = loadSelectedPerson(), message = '', busy = false;
  let scaleProfile: ScaleProfile | null = null, stage: string | null = null, fresh: HTMLElement | null = null;
  const people = () => store?.people ?? [];
  const selected = () => people().find(p => p.id === selectedId) ?? null;
  const owner = () => people().find(isOwner) ?? null;
  void prepareGoogle().catch(() => { /* reported when the button is pressed */ });

  const fail = (e: unknown) => { if (e instanceof NeedsSignIn) store = null; message = e instanceof Error ? e.message : String(e); };
  async function act(op: () => Promise<string | void>) { busy = true; render(); try { message = (await op()) || ''; } catch (e) { fail(e); } busy = false; render(); }

  async function connectGoogle() {
    message = '正在登入 Google…'; busy = true; render();
    try {
      const email = await signIn();
      message = '正在開啟你的試算表…'; render();
      // A new account simply gets its own spreadsheet; switching to an existing one lives in 設定.
      const id = local.get(sheetIdKey(email));
      await (id ? openSheet(id) : Promise.reject()).catch(async () => openSheet(await findOrCreate()));
      message = '';
    } catch (e) { fail(e); }
    busy = false; render();
  }
  async function openSheet(id: string) {
    store = await load(id);
    local.set(sheetIdKey(signedInEmail()), id);
    // A device set up with the old setup code still remembers the identity: adopt it instead of asking for the file.
    const legacyIdentity = local.get(deviceIdentityKey);
    if (!uuid && legacyIdentity && uuidPattern.test(legacyIdentity)) uuid = legacyIdentity.toLowerCase();
    await keepIdentity();
    if (!selected()) { selectedId = owner()?.id ?? people()[0]?.id ?? null; saveSelectedPerson(selectedId); }
  }
  /** The spreadsheet is the one place every device reads the scale identity from: take it from there, or put ours there. */
  async function keepIdentity() {
    if (!store) return;
    if (store.settings[identityKey]) uuid = store.settings[identityKey];
    else if (uuid) await saveSetting(store, identityKey, uuid);
    // The identity belongs to the scale, not to a Google account: remember it on this device for every account.
    if (uuid) local.set(deviceIdentityKey, uuid);
  }
  /** Rarely needed: point this account at a spreadsheet it already had (e.g. from the earlier Apps Script version). */
  async function useExistingSheet() {
    const picked = await pickSpreadsheet();
    if (!picked) return '沒有選擇試算表。';
    const previous = store?.spreadsheetId;
    await adopt(picked);
    if (previous && previous !== picked) await untag(previous);
    await openSheet(picked);
    return `已改用選擇的試算表${previous && previous !== picked ? '。原本那份不再使用，可自行從雲端硬碟刪除' : ''}。`;
  }


  /** Connects and verifies the scale; `mode` decides whether to only read its profile, read stored results, or measure. */
  function useScale(mode: 'profile' | 'stored' | true, done: string) {
    return run(async () => {
      busy = true; message = ''; stage = 'connect'; render();
      try {
        await keepIdentity().catch(() => { /* saving is retried next time; measuring does not depend on it */ });
        if (probe.status !== 'Connected') await probe.connect([observedServiceUuid], scaleNamePrefix);
        if (!probe.characteristics.size) await probe.enumerate();
        const person = selected(), family = mode === true && person && !isOwner(person) ? person : null;
        const text = await identifyScale(probe, uuid, mode, t => { message = t; render(); }, (result, when, profile) => {
          if (!result.detail) return;
          stage = 'save'; render();
          const view = document.createElement('div');
          const status = document.createElement('p'); status.className = 'save-status'; status.textContent = '正在存到你的試算表…';
          // A family member's result is judged with their own sex and age; the owner's with the scale's profile.
          const reportProfile: ReportProfile | null = family ? personProfile(family, result.measuredAt)
            : profile && { sex: profile.sex, age: ageAt(profile.birthDate, result.measuredAt), heightCm: profile.heightCm };
          view.append(status, renderBodyComposition(result.detail, when, reportProfile, family ? '試算表人員資料' : '體脂計個人設定'));
          fresh = view;
          // The result carries the height the scale used: it must be the family member's, or the numbers are not theirs.
          if (family && result.detail.heightCm !== null && Math.abs(result.detail.heightCm - Number(family.身高cm)) > 0.05) {
            const warn = document.createElement('p'); warn.className = 'warn';
            warn.textContent = `體脂計這次用的身高是 ${result.detail.heightCm} cm，與 ${family.姓名} 的 ${family.身高cm} cm 不同，數值可能不是用他的資料計算。請截圖回報。`;
            view.prepend(warn);
          }
          if (store && person && (isOwner(person) || family)) void saveRecords(store, [toRecord(person, result.measuredAt, result.detail)])
            .then(n => { status.textContent = n ? `已存到你的試算表（${person.姓名}）。` : '這筆結果先前已存過，未重複寫入。'; render(); }, e => { status.textContent = `存檔失敗：${e instanceof Error ? e.message : e}`; });
        }, { stage: s => { stage = s; render(); }, profile: p => { scaleProfile = p; },
          measureFor: family ? { name: family.姓名, birthDate: family.出生日期, sex: family.性別, heightCm: Number(family.身高cm) } : undefined });
        if (mode === 'profile') message = text; else message = fresh ? '' : text;
      } catch (e) { fail(e); throw e; }
      finally { busy = false; stage = null; render(); }
    }, done);
  }

  function signInView() {
    const hint = rememberedEmail();
    section.innerHTML = `<h2>歡迎</h2><p class="hint">用 Google 帳號登入。人員和量測紀錄會存在你自己雲端硬碟裡的試算表，任何手機或電腦登入同一個帳號都看得到。</p>
      <button class="big" data-act="signin" ${busy ? 'disabled' : ''}>${hint ? `繼續以 ${esc(hint)} 使用` : '用 Google 登入'}</button>
      ${hint ? '<button class="quiet" data-act="other">改用其他 Google 帳號</button>' : ''}<p role="status">${esc(message)}</p>`;
    on('signin', () => void connectGoogle());
    on('other', () => { signOut(); void connectGoogle(); });
  }

  /** File input for the scale identity, shown only when a measurement needs it and none is stored yet. */
  function identityBox() {
    return `<div class="import identity-box"><h3>第一次量測：連接體脂計</h3>
      <p class="hint">網頁需要一組「身分」才能和你的體脂計對話。載入一次就會存進你的試算表，之後每台裝置都會自動取得。</p>
      <label>身分檔（identity-probe.json）<input type="file" accept=".json" data-field="identity"></label>
      <p class="hint">網頁自己和體脂計配對的功能開發中，完成後這裡會改成「按一下配對」。</p></div>`;
  }
  function bindIdentityBox() {
    section.querySelector<HTMLInputElement>('[data-field=identity]')?.addEventListener('change', e => void act(async () => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 2048) throw Error('這不是身分檔，請選擇 identity-probe.json');
      const data = JSON.parse(await file.text());
      if (data.purpose !== 'RD545_IDENTITY_PROBE' || typeof data.appUuid !== 'string' || !uuidPattern.test(data.appUuid)) throw Error('身分檔格式錯誤');
      uuid = data.appUuid.toLowerCase(); needIdentity = false; local.set(deviceIdentityKey, uuid);
      await saveSetting(store!, identityKey, uuid);
      return '已連接體脂計。請再按一次「開始量測」。';
    }));
  }

  function homeView() {
    const person = selected(), groups = [...new Set(people().map(x => x.群組))], p = scaleProfile;
    const canMeasure = !!person && (isOwner(person) || complete(person));
    const picker = people().length
      ? `<label>量測者<select data-field="person">${groups.map(g => `<optgroup label="${esc(g)}">${people().filter(x => x.群組 === g).map(x =>
          `<option value="${esc(x.id)}" ${x.id === person?.id ? 'selected' : ''}>${esc(x.姓名)}${isOwner(x) ? '（本人）' : ''}</option>`).join('')}</optgroup>`).join('')}</select></label>
        <div class="person-actions">${person ? '<button type="button" class="link" data-act="edit">編輯資料</button>' : ''}<button type="button" class="link" data-act="add">＋ 新增家人</button></div>
        ${person && !complete(person) ? `<p class="warn">${esc(person.姓名)} 的資料不完整（${missing(person).join('、')}），無法依性別年齡判定標準。請按「編輯資料」補上。</p>` : ''}
        ${person ? `<form class="add" data-form="edit" hidden>${personFields(person, groups)}<button type="submit">儲存</button></form>` : ''}
        <form class="add" data-form="member" hidden>${personFields({ 群組: groups[0] ?? '家人' }, groups)}<button type="submit">新增</button></form>`
      : `<div class="import"><h3>先新增你自己</h3><p class="hint">填好之後就能開始量測。${uuid ? '體脂計在旁邊的話，可以按「從體脂計讀取」自動帶入性別、生日與身高。' : ''}</p>
        ${uuid && !p ? `<button class="secondary" data-act="profile" ${busy ? 'disabled' : ''}>從體脂計讀取</button>` : ''}
        <form class="add" data-form="owner">${personFields({ 群組: '家人', 性別: p?.sex, 出生日期: p ? p.birthDate.toISOString().slice(0, 10) : '', 身高cm: p ? String(p.heightCm) : '' }, [])}
          <button type="submit" ${busy ? 'disabled' : ''}>完成</button></form></div>`;
    section.innerHTML = `<div class="heading"><h2>你的紀錄</h2><span class="badge">${esc(signedInEmail())}</span></div>
      ${picker}
      ${people().length && !hasBluetooth ? noBluetoothBox() : ''}
      ${people().length && hasBluetooth ? `<button class="big measure" data-act="measure" ${busy || !canMeasure ? 'disabled' : ''}>開始量測</button>
      ${person && !isOwner(person) && canMeasure ? `<p class="hint">替 ${esc(person.姓名)} 量測時，會把他的生日、性別、身高暫時寫入體脂計，量完自動改回你的資料。</p>` : ''}
      ${canMeasure && !busy ? '<p class="hint">先輕踩一下體脂計，讓螢幕亮起來（體脂計休眠時藍牙找不到它），再按「開始量測」。</p>' : ''}
      ${needIdentity && !uuid ? identityBox() : ''}${progress()}<p role="status">${esc(message)}</p>
      ${isOwner(person) ? `<button class="link" data-act="sync" ${busy ? 'disabled' : ''}>已經在體脂計上量過了？只同步結果</button>` : ''}` : `${progress()}<p role="status">${esc(message)}</p>`}
      <div class="report"></div>
      <details class="settings"><summary>設定</summary><div class="actions">
        <a class="button secondary" href="${spreadsheetUrl(store!.spreadsheetId)}" target="_blank" rel="noopener">開啟試算表</a>
        <button class="secondary" data-act="refresh">重新整理</button>
        <button class="secondary" data-act="switch-sheet">改用其他試算表</button>
        <button class="quiet" data-act="signout">登出</button></div></details>`;
    section.querySelector<HTMLSelectElement>('[data-field=person]')?.addEventListener('change', e => { selectedId = (e.target as HTMLSelectElement).value; saveSelectedPerson(selectedId); fresh = null; message = ''; render(); });
    const toggle = (form: string) => () => { const f = section.querySelector<HTMLFormElement>(`[data-form=${form}]`)!; f.hidden = !f.hidden; };
    on('add', toggle('member'));
    on('edit', toggle('edit'));
    personForm('member', false);
    personForm('owner', true);
    if (person) personForm('edit', isOwner(person), person);
    bindIdentityBox();
    // The scale is only needed when measuring; without an identity yet, ask for it right here.
    const needsScale = (go: () => void) => () => { if (!uuid) { needIdentity = true; message = ''; render(); return; } go(); };
    on('measure', needsScale(() => {
      if (person && !isOwner(person) && local.get(familyConsentKey) !== '1') {
        if (!confirm(`替 ${person.姓名} 量測時，會把他的生日、性別、身高暫時寫入體脂計，量完自動改回你的資料。要繼續嗎？`)) return;
        local.set(familyConsentKey, '1');
      }
      void useScale(true, '量測完成。');
    }));
    on('sync', needsScale(() => void useScale('stored', '已同步體脂計的結果。')));
    on('profile', () => void useScale('profile', '已讀取體脂計資料。'));
    on('refresh', () => void act(async () => { store = await load(store!.spreadsheetId); await keepIdentity(); }));
    on('switch-sheet', () => void act(useExistingSheet));
    on('signout', () => { signOut(); store = null; fresh = null; message = '已登出。'; render(); });
    // Result area: a fresh reading from this visit, otherwise the newest saved row; then the trend.
    const report = section.querySelector<HTMLElement>('.report')!;
    if (fresh) report.append(fresh);
    else if (person) {
      const rows = store!.records.filter(r => r['人員id'] === person.id).sort((a, b) => +new Date(String(a['量測時間'])) - +new Date(String(b['量測時間'])));
      const saved = rows.length ? fromRecord(rows[rows.length - 1]) : null;
      if (saved) {
        const birth = new Date(`${person.出生日期}T00:00:00Z`), height = Number(person.身高cm);
        const profile = isNaN(+birth) || !height ? null : { sex: person.性別, age: ageAt(birth, saved.measuredAt), heightCm: height };
        report.append(renderBodyComposition(saved.detail, `最新一次・${taipeiTime(saved.measuredAt)}`, profile, '試算表人員資料'));
        const exportBtn = document.createElement('button'); exportBtn.className = 'secondary'; exportBtn.textContent = '輸出報告圖片';
        exportBtn.onclick = () => void act(async () => {
          const history = rows.map(r => fromRecord(r)).filter((x): x is NonNullable<typeof x> => !!x).map(x => ({ at: x.measuredAt, weight: x.detail.weightKg, fat: x.detail.bodyFatPct, muscle: x.detail.muscleMassKg }));
          const out = await exportReport({ name: person.姓名, profile, measuredAt: saved.measuredAt, detail: saved.detail, history });
          return `已下載「${out.name}」（${out.width}×${out.height}，${(out.bytes / 1048576).toFixed(1)} MB）。請從「下載」資料夾開啟原檔；傳給別人時請選「原圖」或以檔案傳送，避免被壓縮。`;
        });
        report.prepend(exportBtn);
      }
    }
    if (person) report.append(renderTrend(store!.records, person), manageRecords(person));
    on('copy-link', () => void navigator.clipboard.writeText(location.origin + location.pathname).then(() => { message = '網址已複製，請到 Bluefy 貼上開啟。'; render(); }, () => { message = `請手動複製網址：${location.origin + location.pathname}`; render(); }));
  }

  function personProfile(p: Person, at: Date): ReportProfile | null {
    const birth = new Date(`${p.出生日期}T00:00:00Z`), height = Number(p.身高cm);
    return isNaN(+birth) || !height ? null : { sex: p.性別, age: ageAt(birth, at), heightCm: height };
  }

  /** iPhone/iPad browsers (all WebKit) have no Web Bluetooth; viewing works, measuring needs a Bluetooth-capable browser. */
  function noBluetoothBox() {
    return isIos
      ? `<div class="import no-bt"><h3>iPhone／iPad 無法直接量測</h3>
        <p class="hint">蘋果不開放網頁使用藍牙，所以 Safari、Chrome 都連不上體脂計。看紀錄、趨勢和輸出報告不受影響。要在 iPhone 量測，請改用免費的 Bluefy 瀏覽器：</p>
        <ol class="qr-steps"><li>下載 <a href="https://apps.apple.com/app/id1492822055" target="_blank" rel="noopener">Bluefy – Web BLE Browser</a></li><li><button type="button" class="link" data-act="copy-link">複製這個網址</button>，在 Bluefy 貼上開啟</li><li>用 Google 登入後就能按「開始量測」</li></ol></div>`
      : '<div class="import no-bt"><h3>這個瀏覽器不支援藍牙</h3><p class="hint">請改用 Chrome 或 Edge（Android 手機或電腦）開啟這個網頁才能量測。看紀錄、趨勢和輸出報告不受影響。</p></div>';
  }

  /** Delete a wrong measurement, or move it to the person who actually stood on the scale. Values are never edited. */
  function manageRecords(person: Person): HTMLElement {
    const rows = store!.records.filter(r => r['人員id'] === person.id).map(r => ({ r, at: new Date(String(r['量測時間'])) })).filter(x => !isNaN(+x.at)).sort((a, b) => +b.at - +a.at);
    const box = document.createElement('details'); box.className = 'manage';
    const summary = document.createElement('summary'); summary.textContent = `管理紀錄（${rows.length} 筆）`; box.append(summary);
    const others = people().filter(x => x.id !== person.id);
    for (const { r, at } of rows) {
      const key = String(r['紀錄鍵']), item = document.createElement('div'); item.className = 'record-row';
      const text = document.createElement('span');
      const num = (k: string, d: number, u: string) => typeof r[k] === 'number' ? `${(r[k] as number).toFixed(d)}${u}` : '—';
      text.textContent = `${taipeiTime(at).slice(0, 16)}　${num('體重kg', 1, ' kg')}　體脂 ${num('體脂率%', 1, '%')}`;
      const del = document.createElement('button'); del.className = 'quiet'; del.textContent = '刪除';
      del.onclick = () => { if (confirm(`刪除 ${taipeiTime(at).slice(0, 16)} 這筆紀錄？刪除後無法復原。`)) void act(async () => { await deleteRecord(store!, key); fresh = null; return '已刪除這筆紀錄。'; }); };
      item.append(text, del);
      if (others.length) {
        const pick = document.createElement('select'); pick.className = 'move-to';
        pick.append(new Option('移給…', ''), ...others.map(o => new Option(o.姓名, o.id)));
        pick.onchange = () => { const to = others.find(o => o.id === pick.value); if (!to) return;
          if (!confirm(`把這筆紀錄改成 ${to.姓名} 的？`)) { pick.value = ''; return; }
          void act(async () => { await moveRecord(store!, key, to); fresh = null; return `已移給 ${to.姓名}。`; }); };
        item.append(pick);
      }
      box.append(item);
    }
    if (!rows.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = '還沒有紀錄。'; box.append(p); }
    return box;
  }

  /** Name, birth date and sex are required for every person: the standards depend on sex and age. */
  function personFields(v: Partial<Person>, groups: string[]) {
    const sex = v.性別 === 'male' || v.性別 === 'female' ? v.性別 : '';
    return `<label>姓名<input name="姓名" required value="${esc(v.姓名 ?? '')}"></label>
      <label>群組<input name="群組" required list="rd545-groups" value="${esc(v.群組 ?? '')}"></label><datalist id="rd545-groups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
      <label>性別<select name="性別" required><option value="" ${sex ? '' : 'selected'} disabled>請選擇</option><option value="male" ${sex === 'male' ? 'selected' : ''}>男</option><option value="female" ${sex === 'female' ? 'selected' : ''}>女</option></select></label>
      <label>出生日期<input name="出生日期" type="date" required max="${new Date().toISOString().slice(0, 10)}" value="${esc(v.出生日期 ?? '')}"></label>
      <label>身高 (cm)<input name="身高cm" type="number" min="80" max="250" step="0.1" required value="${esc(v.身高cm ?? '')}"></label>`;
  }
  function personForm(name: 'owner' | 'member' | 'edit', asOwner: boolean, existing?: Person) {
    const form = section.querySelector<HTMLFormElement>(`[data-form=${name}]`);
    if (!form) return;
    form.onsubmit = event => {
      event.preventDefault();
      const d = new FormData(form);
      const person = { ...existing, 群組: String(d.get('群組')).trim(), 姓名: String(d.get('姓名')).trim(), 性別: d.get('性別') as Person['性別'],
        出生日期: String(d.get('出生日期')), 身高cm: String(d.get('身高cm')), 體脂計本人: asOwner ? 'true' : 'false' };
      if (!complete(person)) { message = `請填完整：${missing(person).join('、')}`; render(); return; }
      void act(async () => { const saved = await savePerson(store!, person); selectedId = saved.id; saveSelectedPerson(selectedId); return existing ? `已更新 ${saved.姓名} 的資料。` : asOwner ? '' : `已新增 ${saved.姓名}。`; });
    };
  }

  const on = (act: string, handler: () => void) => section.querySelector<HTMLButtonElement>(`[data-act=${act}]`)?.addEventListener('click', handler);
  function progress() {
    if (!stage) return '';
    const at = stages.findIndex(s => s.key === stage);
    return `<ol class="progress">${stages.map((s, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}">${s.label}</li>`).join('')}</ol>`;
  }
  function render() {
    if (!store || !isSignedIn()) signInView();
    else homeView();
  }
  render();
}
