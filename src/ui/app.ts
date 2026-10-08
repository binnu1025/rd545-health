import type { BleProbe } from '../bluetooth/BleProbe';
import { observedServiceUuid } from '../bluetooth/autoReceive';
import { identifyScale, type ScaleStage } from '../bluetooth/identityProbe';
import { ageAt, type ScaleProfile } from '../bluetooth/userProfile';
import { isSignedIn, NeedsSignIn, prepareGoogle, rememberedEmail, signedInEmail, signIn, signOut } from '../google/googleAuth';
import { findOrCreate, load, savePerson, saveRecords, saveSetting, spreadsheetUrl, type Store } from '../google/sheetStore';
import { fromRecord, listAll, loadConfig, loadSelectedPerson, saveConfig, saveSelectedPerson, toRecord, type Person } from '../storage/sheetClient';
import { renderBodyComposition, type ReportProfile } from './bodyFigure';
import { renderTrend } from './trendChart';

/**
 * The whole everyday screen as one guided flow:
 * sign in → connect the scale (identity) → "is this you?" (owner from the scale's own profile) → home
 * (pick a person, one "開始量測" button, latest result, trend).
 */
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const scaleNamePrefix = 'TNT_BW', identityKey = '體脂計身分';
const sheetIdKey = (email: string) => `rd545.sheetId.${email}`;
const local = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* visit-only */ } } };
const isOwner = (p: Person | null | undefined) => p?.體脂計本人 === 'true';
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
  let store: Store | null = null, uuid = '', selectedId = loadSelectedPerson(), message = '', busy = false;
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
      let id = local.get(sheetIdKey(email));
      try { if (!id) throw Error(); store = await load(id); }
      catch { id = await findOrCreate(); local.set(sheetIdKey(email), id); store = await load(id); }
      // A device set up with the old setup code still remembers the identity: adopt it instead of asking for the file.
      const legacyIdentity = local.get('rd545.identity');
      uuid = store.settings[identityKey] || uuid || (legacyIdentity && uuidPattern.test(legacyIdentity) ? legacyIdentity.toLowerCase() : '');
      if (uuid && !store.settings[identityKey]) await saveSetting(store, identityKey, uuid);
      if (!selected()) { selectedId = owner()?.id ?? people()[0]?.id ?? null; saveSelectedPerson(selectedId); }
      message = '';
    } catch (e) { fail(e); }
    busy = false; render();
  }

  /** Connects and verifies the scale; `mode` decides whether to only read its profile, read stored results, or measure. */
  function useScale(mode: 'profile' | 'stored' | true, done: string) {
    return run(async () => {
      busy = true; message = ''; stage = 'connect'; render();
      try {
        if (probe.status !== 'Connected') await probe.connect([observedServiceUuid], scaleNamePrefix);
        if (!probe.characteristics.size) await probe.enumerate();
        const text = await identifyScale(probe, uuid, mode, t => { message = t; render(); }, (result, when, profile) => {
          if (!result.detail) return;
          stage = 'save'; render();
          const view = document.createElement('div');
          const status = document.createElement('p'); status.className = 'save-status'; status.textContent = '正在存到你的試算表…';
          const reportProfile: ReportProfile | null = profile && { sex: profile.sex, age: ageAt(profile.birthDate, result.measuredAt), heightCm: profile.heightCm };
          view.append(status, renderBodyComposition(result.detail, when, reportProfile));
          fresh = view;
          const person = selected();
          if (store && person && isOwner(person)) void saveRecords(store, [toRecord(person, result.measuredAt, result.detail)])
            .then(n => { status.textContent = n ? `已存到你的試算表（${person.姓名}）。` : '這筆結果先前已存過，未重複寫入。'; render(); }, e => { status.textContent = `存檔失敗：${e instanceof Error ? e.message : e}`; });
        }, { stage: s => { stage = s; render(); }, profile: p => { scaleProfile = p; } });
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

  function identityView() {
    section.innerHTML = `${stepper(2)}<h2>連接你的體脂計</h2>
      <p class="hint">網頁需要一組「身分」才能和你的體脂計對話。載入一次後會存進你的試算表，之後每台裝置登入就自動取得。</p>
      <label>身分檔（identity-probe.json）<input type="file" accept=".json" data-field="identity"></label>
      <p class="hint">還沒有身分檔？網頁自己和體脂計配對的功能開發中，完成後這一步會改成「按一下配對」。</p><p role="status">${esc(message)}</p>`;
    section.querySelector<HTMLInputElement>('[data-field=identity]')!.onchange = e => void act(async () => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 2048) throw Error('這不是身分檔，請選擇 identity-probe.json');
      const data = JSON.parse(await file.text());
      if (data.purpose !== 'RD545_IDENTITY_PROBE' || typeof data.appUuid !== 'string' || !uuidPattern.test(data.appUuid)) throw Error('身分檔格式錯誤');
      uuid = data.appUuid.toLowerCase();
      await saveSetting(store!, identityKey, uuid);
    });
  }

  function whoView() {
    const p = scaleProfile, birth = p ? p.birthDate.toISOString().slice(0, 10) : '';
    section.innerHTML = `${stepper(3)}<h2>這是你嗎？</h2>
      <p class="hint">${p ? '已從體脂計讀到下面的資料，填上名字就完成了。' : '按「從體脂計讀取」自動帶入體脂計裡的性別、生日與身高（體脂計需在附近），或自己填寫。'}</p>
      ${p ? '' : `<button class="secondary" data-act="profile" ${busy ? 'disabled' : ''}>從體脂計讀取</button>`}${progress()}
      <form class="add" data-form="owner">
        <label>你的名字<input name="姓名" required></label>
        <label>群組<input name="群組" required value="家人"></label>
        <label>性別<select name="性別"><option value="male" ${p?.sex === 'male' ? 'selected' : ''}>男</option><option value="female" ${p?.sex === 'female' ? 'selected' : ''}>女</option></select></label>
        <label>出生日期<input name="出生日期" type="date" required value="${birth}"></label>
        <label>身高 (cm)<input name="身高cm" type="number" min="80" max="250" step="0.1" required value="${p?.heightCm ?? ''}"></label>
        <button type="submit" ${busy ? 'disabled' : ''}>完成</button></form><p role="status">${esc(message)}</p>`;
    on('profile', () => void useScale('profile', '已讀取體脂計資料。'));
    personForm('owner', true);
  }

  function homeView() {
    const person = selected(), groups = [...new Set(people().map(x => x.群組))], legacy = loadConfig();
    const canMeasure = isOwner(person);
    section.innerHTML = `<div class="heading"><h2>量測</h2><span class="badge">${esc(signedInEmail())}</span></div>
      <div class="chips-groups">${groups.map(g => `<div class="chip-group"><small>${esc(g)}</small><div class="chips">${people().filter(x => x.群組 === g).map(x =>
        `<button type="button" class="chip" data-person="${esc(x.id)}" aria-pressed="${x.id === person?.id}">${esc(x.姓名)}${isOwner(x) ? '・本人' : ''}</button>`).join('')}</div></div>`).join('')}
        <button type="button" class="chip add-chip" data-act="add">＋ 新增家人</button></div>
      <form class="add" data-form="member" hidden>
        <label>名字<input name="姓名" required></label><label>群組<input name="群組" required list="rd545-groups" value="${esc(groups[0] ?? '家人')}"></label><datalist id="rd545-groups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
        <label>性別<select name="性別"><option value="male">男</option><option value="female">女</option></select></label>
        <label>出生日期<input name="出生日期" type="date" required></label><label>身高 (cm)<input name="身高cm" type="number" min="80" max="250" step="0.1" required></label>
        <button type="submit">新增</button></form>
      <button class="big measure" data-act="measure" ${busy || !canMeasure ? 'disabled' : ''}>開始量測</button>
      ${!canMeasure && person ? `<p class="warn">${esc(person.姓名)} 的量測還不能用：體脂計目前只會用本人的身高、年齡、性別計算。替家人量測的功能開發中。</p>` : ''}
      ${progress()}<p role="status">${esc(message)}</p>
      <button class="link" data-act="sync" ${busy ? 'disabled' : ''}>已經在體脂計上量過了？只同步結果</button>
      <div class="report"></div>
      <details class="settings"><summary>設定</summary><div class="actions">
        <a class="button secondary" href="${spreadsheetUrl(store!.spreadsheetId)}" target="_blank" rel="noopener">開啟試算表</a>
        <button class="secondary" data-act="refresh">重新整理</button>${legacy ? '<button class="secondary" data-act="migrate">匯入舊試算表資料</button>' : ''}
        <button class="quiet" data-act="signout">登出</button></div></details>`;
    section.querySelectorAll<HTMLButtonElement>('[data-person]').forEach(b => b.onclick = () => { selectedId = b.dataset.person!; saveSelectedPerson(selectedId); fresh = null; message = ''; render(); });
    on('add', () => { const f = section.querySelector<HTMLFormElement>('[data-form=member]')!; f.hidden = !f.hidden; });
    personForm('member', false);
    on('measure', () => void useScale(true, '量測完成。'));
    on('sync', () => void useScale('stored', '已同步體脂計的結果。'));
    on('refresh', () => void act(async () => { store = await load(store!.spreadsheetId); }));
    on('signout', () => { signOut(); store = null; fresh = null; message = '已登出。'; render(); });
    on('migrate', () => void act(async () => {
      const old = await listAll(legacy!);
      for (const p of old.people) if (!people().some(x => x.id === p.id)) await savePerson(store!, { ...p, 身高cm: String(p.身高cm), 出生日期: String(p.出生日期), 體脂計本人: String(p.體脂計本人) });
      const added = await saveRecords(store!, old.records.map(r => ({ ...r, 量測時間: new Date(String(r['量測時間'])).toISOString() })));
      saveConfig(null);
      return `已匯入 ${old.people.length} 位人員、${added} 筆紀錄。`;
    }));
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
      }
    }
    if (person) report.append(renderTrend(store!.records, person));
  }

  function personForm(name: 'owner' | 'member', asOwner: boolean) {
    const form = section.querySelector<HTMLFormElement>(`[data-form=${name}]`);
    if (!form) return;
    form.onsubmit = event => {
      event.preventDefault();
      const d = new FormData(form);
      const person = { 群組: String(d.get('群組')).trim(), 姓名: String(d.get('姓名')).trim(), 性別: d.get('性別') as Person['性別'],
        出生日期: String(d.get('出生日期')), 身高cm: String(d.get('身高cm')), 體脂計本人: asOwner ? 'true' : 'false' };
      void act(async () => { const saved = await savePerson(store!, person); selectedId = saved.id; saveSelectedPerson(selectedId); return asOwner ? '' : `已新增 ${saved.姓名}。`; });
    };
  }

  const on = (act: string, handler: () => void) => section.querySelector<HTMLButtonElement>(`[data-act=${act}]`)?.addEventListener('click', handler);
  const stepper = (current: number) => `<ol class="stepper">${['登入', '連接體脂計', '建立你的資料'].map((s, i) => `<li class="${i + 1 < current ? 'done' : i + 1 === current ? 'now' : ''}">${s}</li>`).join('')}</ol>`;
  function progress() {
    if (!stage) return '';
    const at = stages.findIndex(s => s.key === stage);
    return `<ol class="progress">${stages.map((s, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}">${s.label}</li>`).join('')}</ol>`;
  }
  function render() {
    if (!store || !isSignedIn()) signInView();
    else if (!uuid) identityView();
    else if (!owner()) whoView();
    else homeView();
  }
  render();
}
