import './styles/global.css';
import { mountBleLab } from './ui/bleLab';
import { mountOfflineDecoder } from './ui/offlineDecoder';
import { rememberUuid, takeSetupFromLink } from './storage/deviceSetup';
import { saveConfig } from './storage/sheetClient';

// Opened from a "send settings to phone" QR code: store them before anything reads the settings.
let setupNotice = '', setupFailed = false;
try {
  const setup = takeSetupFromLink();
  if (setup) { saveConfig(setup.sheet); rememberUuid(setup.uuid); setupNotice = '已套用設定。之後直接打開這個網頁就能用。'; }
} catch (error) { setupFailed = true; setupNotice = `這個設定連結無法使用：${error instanceof Error ? error.message : error}。請在原本的裝置重新產生 QR 碼。`; }

mountBleLab(document.querySelector<HTMLElement>('#app')!);
mountOfflineDecoder(document.querySelector<HTMLElement>('#devtools')!);
if (setupNotice) { const toast = document.getElementById('message')!; toast.textContent = setupNotice; toast.classList.toggle('error', setupFailed); if (!setupFailed) setTimeout(() => { if (toast.textContent === setupNotice) toast.textContent = ''; }, 6000); }
