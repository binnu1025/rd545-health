import { BleProbe } from '../bluetooth/BleProbe';
import { parseHex, parseServices } from '../bluetooth/packetLogger';
import { autoReceive, observedServiceUuid } from '../bluetooth/autoReceive';
import { mountIdentityTest } from './identityTest';
const esc = (text: string) => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function download(content: string, extension: string) {
  const url = URL.createObjectURL(new Blob([content], {type: extension === 'json' ? 'application/json' : 'text/csv;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = `ble-session-${new Date().toISOString().replace(/[:.]/g,'-')}.${extension}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function mountBleLab(root: HTMLElement) {
  const probe = new BleProbe(); let busy = false;
  let receiveErrors: string[] = [];
  const supported = Boolean(navigator.bluetooth); const secure = isSecureContext;
  const platform = /Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) || (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1) ? 'iOS' : /Win/.test(navigator.platform) ? 'Windows' : /Mac/.test(navigator.platform) ? 'Mac' : navigator.platform;
  root.innerHTML = `<header><div class="brand">◉ <span>RD-545 <small>HEALTH MANAGER</small></span></div></header>
    <main><p id="message" role="status" aria-live="polite"></p><details id="devtools" class="devtools"><summary>開發者工具（診斷用，一般使用不需要開啟）</summary><section class="intro"><p class="eyebrow">DEVICE RESEARCH WORKSPACE</p><h1>RD-545 BLE LAB</h1><p>從真實封包開始，驗證每一次連線。</p><div class="notice">尚未完成 RD-545 通訊驗證。本工具不會解碼健康數據，也不會自動發送測量指令。</div></section>
    <section class="card" style="margin-top:24px"><h2>簡易接收</h2><p>先關閉手機 nRF Connect 的連線，讓體脂計處於可連線狀態。</p><button id="auto">一鍵連線並接收</button><p id="receive-state" role="status">選擇設備後，自動探索服務並啟用通知，不必逐個按 Subscribe。</p><p class="hint">已帶入你在 TNT_PAIR 實機觀察到的服務 UUID；尚未確認測量協定。Guest 若需重開機，連線會中斷，請回來再按一次。此功能不會啟動測量或繞過藍牙驗證。</p><details><summary>接收問題詳情</summary><pre id="receive-errors" style="white-space:pre-wrap;overflow-wrap:anywhere">尚無</pre></details></section>
    <section class="environment"><div><small>WEB BLUETOOTH</small><strong>${supported ? 'Supported' : 'Unsupported'}</strong></div><div><small>SECURE CONTEXT</small><strong>${secure ? 'Yes' : 'No'}</strong></div><div><small>PLATFORM</small><strong>${esc(platform)}</strong></div></section>
    <div class="workspace"><div><section class="card"><h2><span>01</span> 設備連線</h2><label for="uuids">已確認的 Service UUID（選填）</label><textarea id="uuids" rows="3" placeholder="從實機工具或 HCI 紀錄取得，每行一筆完整 UUID"></textarea><p class="hint">未填仍可選擇設備及嘗試連線，但無法完整探索服務。新增 UUID 後需重新搜尋，授權才會生效。</p><div class="actions"><button id="connect" ${!supported || !secure ? 'disabled' : ''}>搜尋藍牙設備</button><button id="disconnect" class="secondary" disabled>中斷連線</button></div><div id="connection"></div></section>
    <section class="card"><div class="heading"><h2><span>02</span> GATT 服務</h2><button id="enumerate" class="secondary" disabled>探索服務</button></div><p class="hint">僅顯示瀏覽器已授權的服務，不代表設備的完整服務列表。</p><div id="services" class="empty">連線後，點選「探索服務」。</div></section></div>
    <section class="card log-card"><div class="heading"><h2><span>03</span> 封包紀錄</h2><span id="count" class="badge">0 packets</span></div><p class="hint">RX：讀取／通知 · TX：寫入成功後記錄<br>時間以 Asia/Taipei 顯示；匯出使用 ISO UTC。</p><div class="actions"><button id="json" class="secondary">Export JSON</button><button id="csv" class="secondary">Export CSV</button><button id="copy" class="secondary">Copy HEX</button><button id="clear" class="quiet">Clear Log</button></div><div id="packets" class="packets empty">尚無封包。此處只顯示實際讀寫資料。</div><p class="hint">畫面顯示最近 100 筆，記憶體最多保留 10,000 筆。匯出包含设备識別與原始封包，分享前請檢查內容。</p></section></div>
    <footer>診斷工具的封包只存在本頁記憶體；重新整理即清除，不會上傳。</footer></details></main>`;
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  el<HTMLTextAreaElement>('uuids').value = observedServiceUuid;
  // Toast: errors stay until the next action, other messages fade after a few seconds; empty = hidden.
  let messageTimer = 0;
  const message = (text: string, error = false) => { clearTimeout(messageTimer); el('message').textContent = text; el('message').classList.toggle('error', error); if (!error) messageTimer = window.setTimeout(() => { el('message').textContent = ''; }, 4000); };
  function state() {
    el('connection').innerHTML = `<p class="status"><i class="${probe.status === 'Connected' ? 'online' : ''}"></i>${probe.status}</p><dl><dt>設備名稱</dt><dd>${esc(probe.device?.name || '—')}</dd><dt>設備 ID</dt><dd>${esc(probe.device?.id || '—')}</dd></dl>`;
    el<HTMLButtonElement>('connect').disabled = busy || !supported || !secure;
    el<HTMLButtonElement>('auto').disabled = busy || !supported || !secure;
    if (!busy) {
      el('receive-state').textContent = probe.status === 'Connected'
        ? `已連線，${probe.subscriptions.size} 個接收通道已啟用，收到 ${probe.logger.packets.filter(p => p.direction === 'RX').length} 筆封包。${receiveErrors.length ? '部分通道無法啟用，請查看問題詳情。' : ''}${probe.subscriptions.size && !probe.logger.packets.length ? '目前等待設備傳送；沒有封包不表示測量已啟動。' : ''}`
        : '尚未連線或連線已中斷。讓設備可被搜尋後，按「一鍵連線並接收」。';
    }
    el<HTMLButtonElement>('disconnect').disabled = busy || probe.status !== 'Connected';
    el<HTMLButtonElement>('enumerate').disabled = busy || probe.status !== 'Connected';
    root.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(b => b.disabled = busy || probe.status !== 'Connected');
    el('count').textContent = `${probe.logger.packets.length} packets`;
    const packets = probe.logger.packets.slice(-100).reverse();
    el('packets').innerHTML = packets.length ? packets.map(p => `<article class="packet"><b>${new Date(p.timestamp).toLocaleTimeString('zh-TW', {timeZone:'Asia/Taipei',hour12:false})}.${p.timestamp.slice(20,23)} <em>${p.direction}</em></b><small>Service: ${p.serviceUuid}<br>Characteristic: ${p.characteristicUuid}</small><code>${p.payloadHex || '(empty)'}</code></article>`).join('') : '尚無封包。此處只顯示實際讀寫資料。';
    if (probe.logger.dropped) message(`已達上限，最早 ${probe.logger.dropped} 筆封包已移除；請及時匯出。`, true);
  }
  function services() {
    el('services').innerHTML = probe.services.length ? probe.services.map(s => `<article class="service"><h3>${s.uuid}</h3>${s.error ? `<p class="error">${esc(s.error)}</p>` : ''}${s.characteristics.map(c => {
      const key = `${s.uuid}/${c.uuid}`;
      return `<div class="characteristic"><code>${c.uuid}</code><div class="properties">${c.properties.map(p => `<span>${p}</span>`).join('')}</div><div class="actions">${c.properties.includes('read') ? `<button data-key="${key}" data-action="read" class="secondary">Read</button>` : ''}${c.properties.some(p => p === 'notify' || p === 'indicate') ? `<button data-key="${key}" data-action="notify" class="secondary">${probe.subscriptions.has(key) ? 'Unsubscribe' : 'Subscribe'}</button>` : ''}</div>${c.properties.some(p => p === 'write' || p === 'writeWithoutResponse') ? `<label>HEX 指令<input aria-label="HEX ${c.uuid}" placeholder="請填入已確認的指令"></label><label>寫入模式<select>${c.properties.includes('write') ? '<option value="response">With response</option>' : ''}${c.properties.includes('writeWithoutResponse') ? '<option value="no-response">Without response</option>' : ''}</select></label><button data-key="${key}" data-action="write">Write</button>` : ''}</div>`;
    }).join('')}</article>`).join('') : '尚未取得服務。請核對已授權 UUID；這不代表設備沒有服務。';
    state();
  }
  async function run(operation: () => Promise<void>, success: string) {
    if (busy) return; busy = true; state();
    try { await operation(); message(success); } catch (error) { message(error instanceof Error ? error.message : String(error), true); }
    finally { busy = false; state(); }
  }
  el('auto').onclick = () => void run(async () => {
    const progress = (text: string) => { el('receive-state').textContent = text; message(text); };
    receiveErrors = []; el('receive-errors').textContent = '尚無';
    try {
      if (probe.status !== 'Connected') {
        if (probe.logger.packets.length && !confirm('重新連線會開始新的紀錄。舊封包請先匯出；要繼續嗎？')) return;
        progress('請在瀏覽器視窗選擇設備。');
        await probe.connect(parseServices(el<HTMLTextAreaElement>('uuids').value));
      }
      if (!probe.characteristics.size) { progress('已連線，正在探索服務…'); await probe.enumerate(); }
      receiveErrors = await autoReceive(probe, progress);
      if (!probe.subscriptions.size && !receiveErrors.length) receiveErrors.push('未找到可啟用的通知通道。請確認服務授權及設備狀態。');
    } catch (error) {
      receiveErrors.push(error instanceof Error ? error.message : String(error)); throw error;
    } finally {
      el('receive-errors').textContent = receiveErrors.length ? receiveErrors.join('\n\n') : '尚無'; services();
    }
  }, '自動接收設定完成，請查看上方通道數與接收狀態；這不代表自動測量已支援。');
  el('connect').onclick = () => void run(async () => { await probe.connect(parseServices(el<HTMLTextAreaElement>('uuids').value)); services(); }, 'GATT 已連線；這不表示 RD-545 協定已驗證。請探索服務。');
  el('disconnect').onclick = () => { probe.disconnect(); message('已中斷連線。封包仍保留，可繼續匯出。'); };
  el('enumerate').onclick = () => void run(async () => { try { await probe.enumerate(); } finally { services(); } }, '已完成可存取服務的探索。');
  el('services').onclick = event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-key]'); if (!button) return;
    const key = button.dataset.key!;
    void run(async () => {
      if (button.dataset.action === 'read') await probe.read(key);
      if (button.dataset.action === 'notify') { await probe.toggleNotifications(key); services(); }
      if (button.dataset.action === 'write') {
        const parent = button.closest('.characteristic')!;
        const bytes = parseHex(parent.querySelector('input')!.value);
        if (!window.confirm(`即將向設備寫入 ${bytes.length} bytes。請確認指令來源與用途；未知指令可能更動設備設定。是否寫入？`)) return;
        await probe.write(key, bytes, parent.querySelector('select')!.value === 'no-response');
      }
    }, '操作完成。');
  };
  el('json').onclick = () => download(JSON.stringify(probe.session(), null, 2), 'json');
  el('csv').onclick = () => download(probe.logger.csv(), 'csv');
  el('copy').onclick = () => void run(async () => { await navigator.clipboard.writeText(probe.logger.packets.map(p => `${p.direction} ${p.payloadHex}`).join('\n')); }, 'HEX 已複製。');
  el('clear').onclick = () => { if (confirm('清除所有封包紀錄？此動作無法復原。')) { probe.logger.clear(); state(); } };
  probe.addEventListener('change', state); state();
  mountIdentityTest(root.querySelector('main')!,probe,run,services);
  window.addEventListener('pagehide', () => probe.disconnect());
}
