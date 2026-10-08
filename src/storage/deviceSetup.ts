import { isWebAppUrl, type SheetConfig } from './sheetClient';

/**
 * Moves this browser's settings to another device (e.g. the phone) as one pasteable code:
 * spreadsheet URL + token and the scale identity UUID. It is shown only on the owner's own screen
 * and carries no health data, but it does grant access to both, so it is never put in a URL.
 */
export interface DeviceSetup { sheet: SheetConfig; uuid: string }
const prefix = 'RD545SETUP1:';
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const identityKey = 'rd545.identity';

const toBase64Url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

export function encodeSetup(setup: DeviceSetup): string {
  return prefix + toBase64Url(JSON.stringify({ u: setup.sheet.url, t: setup.sheet.token, i: setup.uuid.toLowerCase() }));
}

export function decodeSetup(code: string): DeviceSetup {
  const text = code.trim();
  if (!text.startsWith(prefix)) throw Error('這不是 RD-545 手機設定碼（應以 RD545SETUP1: 開頭）');
  let data: { u?: unknown; t?: unknown; i?: unknown };
  try { data = JSON.parse(fromBase64Url(text.slice(prefix.length))); } catch { throw Error('設定碼不完整，請重新複製整段'); }
  if (typeof data.u !== 'string' || !isWebAppUrl(data.u) || typeof data.t !== 'string' || !/^[0-9a-f]{48}$/.test(data.t)
    || typeof data.i !== 'string' || !uuidPattern.test(data.i)) throw Error('設定碼內容不正確，請重新複製整段');
  return { sheet: { url: data.u, token: data.t }, uuid: data.i };
}

/**
 * Scan-to-set-up link. The code rides in the URL fragment, which browsers never send to the server,
 * and the page strips it from the address bar as soon as it has been read.
 */
const publicSite = 'https://binnu1025.github.io/rd545-health/';
export function setupLink(code: string, here: Location = location): string {
  // A link to localhost would not open on the phone, so point at the published site instead.
  const base = here.protocol === 'https:' ? here.origin + here.pathname : publicSite;
  return `${base}#setup=${code}`;
}
export function takeSetupFromLink(here: Location = location, history: History = window.history): DeviceSetup | null {
  if (!here.hash.startsWith('#setup=')) return null;
  const code = decodeURIComponent(here.hash.slice('#setup='.length));
  history.replaceState(null, '', here.pathname + here.search);
  return decodeSetup(code);
}

/** Remembered only when the user imported a setup code on this device; the PC keeps the identity in memory only. */
export function loadRememberedUuid(): string | null {
  try { const v = localStorage.getItem(identityKey); return v && uuidPattern.test(v) ? v : null; } catch { return null; }
}
export function rememberUuid(uuid: string | null) {
  try { if (uuid) localStorage.setItem(identityKey, uuid); else localStorage.removeItem(identityKey); } catch { /* storage blocked */ }
}
