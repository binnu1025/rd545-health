/**
 * Google sign-in with Google Identity Services (token model, browser only — no server, no client secret).
 * Scope drive.file lets the page reach only the spreadsheet it created itself, nothing else in the user's Drive.
 */
export const googleClientId = '806333112280-hm6cdm0fmmhftn7bpnh86nkpkckv9bli.apps.googleusercontent.com';
const scope = 'openid email profile https://www.googleapis.com/auth/drive.file';
const hintKey = 'rd545.googleEmail';

interface TokenResponse { access_token?: string; expires_in?: number; error?: string; error_description?: string }
interface TokenClient { requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void }
declare global { interface Window { google?: { accounts: { oauth2: {
  initTokenClient(config: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type: string; message?: string }) => void }): TokenClient;
  revoke(token: string, done?: () => void): void;
} } } } }

let token = '', expiresAt = 0, email = '';
let client: TokenClient | null = null, pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

function loadScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => resolve(); s.onerror = () => reject(Error('無法載入 Google 登入，請確認網路連線'));
    document.head.append(s);
  });
}
/** Load early so the sign-in popup can open straight from the user's tap. */
export async function prepareGoogle() {
  await loadScript();
  client ??= window.google!.accounts.oauth2.initTokenClient({
    client_id: googleClientId, scope,
    callback: r => { if (r.error || !r.access_token) pending?.reject(Error(r.error_description || r.error || '登入失敗')); else { token = r.access_token; expiresAt = Date.now() + (r.expires_in ?? 3600) * 1000 - 60000; pending?.resolve(token); } pending = null; },
    error_callback: e => { pending?.reject(Error(e.type === 'popup_closed' ? '登入視窗已關閉' : e.message || '登入失敗')); pending = null; },
  });
}

export const rememberedEmail = () => { try { return localStorage.getItem(hintKey) ?? ''; } catch { return ''; } };
export const signedInEmail = () => email;
export const isSignedIn = () => !!token && Date.now() < expiresAt;

/** Must be called from a click: opens Google's popup (it closes by itself when the account already agreed). */
export async function signIn(): Promise<string> {
  await prepareGoogle();
  const got = new Promise<string>((resolve, reject) => { pending = { resolve, reject }; });
  const hint = rememberedEmail();
  client!.requestAccessToken(hint ? { prompt: '', login_hint: hint } : { prompt: 'select_account' });
  await got;
  const me = await googleFetch<{ email: string }>('https://www.googleapis.com/oauth2/v3/userinfo');
  email = me.email;
  try { localStorage.setItem(hintKey, email); } catch { /* visit-only */ }
  return email;
}

export function signOut() {
  if (token) window.google?.accounts.oauth2.revoke(token);
  token = ''; expiresAt = 0; email = '';
  try { localStorage.removeItem(hintKey); } catch { /* visit-only */ }
}

/**
 * Google's own file picker, used once by accounts that already have a spreadsheet: picking a file is what
 * grants this drive.file app access to it. The key is a browser key restricted to this site and the Picker API.
 */
export const googlePickerKey = 'AIzaSyApuowWMADkuCqsW2LzlMpqQaetGgZwqlQ';
const googleAppId = googleClientId.split('-')[0];
interface PickerResult { action: string; docs?: { id: string }[] }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PickerNs = any;
let pickerReady: Promise<PickerNs> | null = null;
function loadPicker(): Promise<PickerNs> {
  pickerReady ??= new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = 'https://apis.google.com/js/api.js'; s.async = true;
    s.onload = () => (window as unknown as { gapi: { load(name: string, cb: () => void): void } }).gapi.load('picker', () => resolve((window.google as unknown as { picker: PickerNs }).picker));
    s.onerror = () => { pickerReady = null; reject(Error('無法載入 Google 選檔視窗，請確認網路連線')); };
    document.head.append(s);
  });
  return pickerReady;
}
/** Resolves to the picked spreadsheet id, or null when the user closes the picker. */
export async function pickSpreadsheet(): Promise<string | null> {
  if (!isSignedIn()) throw new NeedsSignIn();
  if (!googlePickerKey) throw Error('選檔功能尚未設定完成');
  const picker = await loadPicker();
  return new Promise(resolve => {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS).setMode(picker.DocsViewMode.LIST);
    new picker.PickerBuilder().addView(view).setOAuthToken(token).setDeveloperKey(googlePickerKey).setAppId(googleAppId)
      .setTitle('選擇你原本的試算表').setLocale('zh-TW')
      .setCallback((r: PickerResult) => { if (r.action === picker.Action.PICKED) resolve(r.docs?.[0]?.id ?? null); else if (r.action === picker.Action.CANCEL) resolve(null); })
      .build().setVisible(true);
  });
}

export class NeedsSignIn extends Error { constructor() { super('Google 登入已過期，請再按一次「用 Google 登入」'); } }

export async function googleFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  if (!isSignedIn()) throw new NeedsSignIn();
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
  if (response.status === 401) { token = ''; throw new NeedsSignIn(); }
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw Error(`Google 服務錯誤 ${response.status}${detail?.error?.message ? `：${detail.error.message}` : ''}`);
  }
  return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}
