import type { BodyComposition } from '../bluetooth/bodyComposition';
import { buildAppsScript } from '../storage/appsScript';
import { isWebAppUrl, listAll, loadConfig, loadSelectedPerson, newToken, saveConfig, savePerson, saveRecord, saveSelectedPerson, toRecord, type Person, type SheetConfig, type SheetRecord } from '../storage/sheetClient';
import { renderTrend } from './trendChart';
import { decodeSetup, encodeSetup, rememberUuid } from '../storage/deviceSetup';
import qrcode from 'qrcode-generator';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pendingTokenKey = 'rd545.pendingToken';
const readPending = () => { try { return localStorage.getItem(pendingTokenKey); } catch { return null; } };
const writePending = (v: string | null) => { try { if (v) localStorage.setItem(pendingTokenKey, v); else localStorage.removeItem(pendingTokenKey); } catch { /* visit-only */ } };
const isOwner = (p: Person | null) => p?.體脂計本人 === 'true';

function renderSetupQr(code: string): HTMLElement {
  const box = document.createElement('div'); box.className = 'qr';
  const qr = qrcode(0, 'M'); qr.addData(code); qr.make();
  const picture = document.createElement('div'); picture.className = 'qr-image'; picture.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  const text = document.createElement('textarea'); text.readOnly = true; text.rows = 3; text.value = code;
  const note = document.createElement('p'); note.className = 'warn';
  note.textContent = '這個 QR 碼可以讀寫你的試算表、也能以你的身分連線體脂計。只在自己的手機掃描，不要拍照傳給別人；用完按「顯示手機設定 QR 碼」收起。';
  box.append(picture, note, text);
  return box;
}

export interface PeoplePanel {
  /** Selected person's most recent saved row, if any. */
  latest(): { person: Person; record: SheetRecord } | null;
  /** Text for the result area: saved / duplicate / why it was not saved. */
  saveResult(measuredAt: Date, detail: BodyComposition): Promise<string>;
}

export function mountPeoplePanel(root: HTMLElement, currentUuid: () => string, onChange: () => void = () => {}): PeoplePanel {
  const section = document.createElement('section');
  section.className = 'card people';
  root.prepend(section);
  let config: SheetConfig | null = loadConfig(), people: Person[] = [], records: SheetRecord[] = [], selectedId = loadSelectedPerson(), message = '';
  const selected = () => people.find(p => p.id === selectedId) ?? null;

  function setupView() {
    let token = readPending();
    if (!token) { token = newToken(); writePending(token); }
    section.innerHTML = `<h2>測量者與 Google 試算表</h2>
      <div class="import"><h3>已經有試算表了：貼上設定碼</h3>
        <p class="hint">在已經設定好的裝置（例如電腦上原本的網頁）按「顯示手機設定 QR 碼」，掃描或複製那段文字貼在這裡。換網址、換瀏覽器或換手機都用這個，不必重建試算表。</p>
        <textarea data-field="code" rows="3" placeholder="RD545SETUP1:…"></textarea><button data-act="import">套用設定碼</button></div>
      <details class="create"><summary>還沒有試算表：建立新的（第一次使用，約 5 分鐘）</summary>
      <p class="hint">量測紀錄會存在登入的 Google 帳號自己的試算表。每個人用自己的 Google 帳號建立，就各自存在自己的試算表。</p>
      <ol class="setup">
        <li>開一份新的 Google 試算表：<a href="https://sheets.new" target="_blank" rel="noopener">sheets.new</a></li>
        <li>點選單「擴充功能」→「Apps Script」，把原本的內容全部刪掉，貼上下面的程式碼，按儲存（磁碟圖示）。
          <textarea class="script" readonly rows="6">${esc(buildAppsScript(token))}</textarea>
          <button class="secondary" data-act="copy">複製程式碼</button></li>
        <li>右上角「部署」→「新增部署作業」→ 齒輪選「網頁應用程式」→ 執行身分選「我」、誰可以存取選「所有人」→ 部署。第一次會要求授權，選你的帳號並允許。</li>
        <li>複製「網頁應用程式」網址（https://script.google.com/macros/s/…/exec），貼到這裡：
          <input data-field="url" placeholder="https://script.google.com/macros/s/…/exec"><button data-act="connect">連線測試</button></li>
      </ol>
      <p class="hint">程式碼裡含有只屬於你的密鑰，請勿分享程式碼或網址。</p></details><p role="status">${esc(message)}</p>`;
    section.querySelector<HTMLButtonElement>('[data-act=copy]')!.onclick = async () => {
      try { await navigator.clipboard.writeText(buildAppsScript(token!)); message = '程式碼已複製。'; } catch { message = '無法自動複製，請手動全選文字框內容複製。'; }
      section.querySelector('[role=status]')!.textContent = message;
    };
    section.querySelector<HTMLButtonElement>('[data-act=import]')!.onclick = async () => {
      const status = section.querySelector('[role=status]')!;
      try {
        const setup = decodeSetup(section.querySelector<HTMLTextAreaElement>('[data-field=code]')!.value);
        status.textContent = '正在連線…';
        await listAll(setup.sheet);
        saveConfig(setup.sheet); rememberUuid(setup.uuid); writePending(null);
        // Reload so the identity panel picks up the remembered identity too.
        location.reload();
      } catch (e) { status.textContent = String(e instanceof Error ? e.message : e); }
    };
    section.querySelector<HTMLButtonElement>('[data-act=connect]')!.onclick = async () => {
      const url = section.querySelector<HTMLInputElement>('[data-field=url]')!.value.trim();
      const status = section.querySelector('[role=status]')!;
      if (!isWebAppUrl(url)) { status.textContent = '網址格式不對：應該是 https://script.google.com/macros/s/…/exec'; return; }
      status.textContent = '正在連線…';
      try { const candidate = { url, token: token! }; ({ people, records } = await listAll(candidate)); config = candidate; saveConfig(config); writePending(null); message = '已連上 Google 試算表。'; render(); }
      catch (e) { status.textContent = `${e instanceof Error ? e.message : e}。請確認步驟 3 的「誰可以存取」是「所有人」，且貼的是最新部署的網址。`; }
    };
  }

  function connectedView() {
    const groups = [...new Set(people.map(p => p.群組))];
    const person = selected(), group = person?.群組 ?? groups[0] ?? '';
    const inGroup = people.filter(p => p.群組 === group);
    section.innerHTML = `<div class="heading"><h2>測量者</h2><span class="badge">已連上 Google 試算表</span></div>
      <div class="pick"><label>群組<select data-field="group">${groups.map(g => `<option ${g === group ? 'selected' : ''}>${esc(g)}</option>`).join('') || '<option value="">（尚無群組）</option>'}</select></label>
      <label>人員<select data-field="person"><option value="">請選擇</option>${inGroup.map(p => `<option value="${esc(p.id)}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.姓名)}${isOwner(p) ? '（體脂計本人）' : ''}</option>`).join('')}</select></label></div>
      ${person && !isOwner(person) ? '<p class="warn">目前只支援「體脂計本人」：體脂計會用本人的身高、年齡、性別計算，其他人站上去的數值不準，因此不會存檔。</p>' : ''}
      ${person ? `<p class="hint">${person.性別 === 'male' ? '男' : '女'}・出生 ${esc(person.出生日期)}・${esc(person.身高cm)} cm</p>` : '<p class="hint">選好測量者後再讀取結果，才會存進試算表。</p>'}
      <details><summary>新增人員</summary><form class="add">
        <label>群組<input name="群組" list="rd545-groups" required></label><datalist id="rd545-groups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
        <label>姓名<input name="姓名" required></label>
        <label>性別<select name="性別"><option value="male">男</option><option value="female">女</option></select></label>
        <label>出生日期<input name="出生日期" type="date" required></label>
        <label>身高 (cm)<input name="身高cm" type="number" min="80" max="250" step="0.1" required></label>
        <label class="inline"><input name="體脂計本人" type="checkbox"> 這是體脂計裡設定的本人</label>
        <button type="submit">儲存人員</button></form></details>
      <div class="phone-setup"></div>
      <div class="actions"><button class="secondary" data-act="phone">顯示手機設定 QR 碼</button><button class="secondary" data-act="refresh">重新整理名單</button><button class="quiet" data-act="forget">取消試算表設定</button></div>
      <p role="status">${esc(message)}</p>`;
    const groupSelect = section.querySelector<HTMLSelectElement>('[data-field=group]')!, personSelect = section.querySelector<HTMLSelectElement>('[data-field=person]')!;
    groupSelect.onchange = () => { selectedId = people.find(p => p.群組 === groupSelect.value)?.id ?? null; saveSelectedPerson(selectedId); message = ''; render(); };
    personSelect.onchange = () => { selectedId = personSelect.value || null; saveSelectedPerson(selectedId); message = ''; render(); };
    section.querySelector<HTMLFormElement>('form.add')!.onsubmit = async event => {
      event.preventDefault();
      const form = event.target as HTMLFormElement, data = new FormData(form);
      const person = { 群組: String(data.get('群組')).trim(), 姓名: String(data.get('姓名')).trim(), 性別: data.get('性別') as Person['性別'],
        出生日期: String(data.get('出生日期')), 身高cm: String(data.get('身高cm')), 體脂計本人: data.get('體脂計本人') ? 'true' : 'false' };
      if (person.體脂計本人 === 'true' && people.some(isOwner)) { message = '已經有一位「體脂計本人」，同一台體脂計只能有一位。'; render(); return; }
      try { const saved = (await savePerson(config!, person)).person; people.push(saved); selectedId = saved.id; saveSelectedPerson(selectedId); message = `已新增 ${saved.姓名}。`; }
      catch (e) { message = String(e instanceof Error ? e.message : e); }
      render();
    };
    section.querySelector<HTMLButtonElement>('[data-act=phone]')!.onclick = () => {
      const host = section.querySelector<HTMLElement>('.phone-setup')!;
      if (host.childElementCount) { host.replaceChildren(); return; }
      const uuid = currentUuid();
      if (!uuid) { host.innerHTML = '<p class="warn">請先在下方「私人身分檔」載入 identity-probe.json，設定碼才能包含體脂計身分。</p>'; return; }
      host.replaceChildren(renderSetupQr(encodeSetup({ sheet: config!, uuid })));
    };
    section.querySelector<HTMLButtonElement>('[data-act=refresh]')!.onclick = () => void refresh();
    section.querySelector<HTMLButtonElement>('[data-act=forget]')!.onclick = () => {
      if (!confirm('取消後，這個瀏覽器不再寫入試算表（試算表裡的資料不會刪除）。要繼續嗎？')) return;
      config = null; saveConfig(null); people = []; records = []; message = ''; render();
    };
    if (person) section.append(renderTrend(records, person));
  }

  function render() { if (config) connectedView(); else setupView(); onChange(); }
  async function refresh() {
    if (!config) return render();
    try { ({ people, records } = await listAll(config)); message = ''; } catch (e) { message = `無法讀取名單：${e instanceof Error ? e.message : e}`; }
    render();
  }
  render();
  void refresh();

  return {
    latest() {
      const person = selected();
      if (!person) return null;
      const rows = records.filter(r => r['人員id'] === person.id).sort((a, b) => +new Date(String(a['量測時間'])) - +new Date(String(b['量測時間'])));
      return rows.length ? { person, record: rows[rows.length - 1] } : null;
    },
    async saveResult(measuredAt, detail) {
      if (!config) return '尚未設定 Google 試算表，這次結果沒有存檔。';
      const person = selected();
      if (!person) return '尚未選擇測量者，這次結果沒有存檔。';
      if (!isOwner(person)) return `${person.姓名} 不是體脂計本人，這次結果沒有存檔。`;
      try {
        const { duplicate } = await saveRecord(config, toRecord(person, measuredAt, detail));
        void refresh();
        return duplicate ? `這筆結果先前已存過（${person.姓名}），未重複寫入。` : `已存到 Google 試算表（${person.姓名}），趨勢圖已更新。`;
      }
      catch (e) { return `存檔失敗：${e instanceof Error ? e.message : e}。結果仍顯示在下方，可稍後再讀取一次存檔。`; }
    },
  };
}
