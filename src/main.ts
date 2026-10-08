import './styles/global.css';
import { mountBleLab } from './ui/bleLab';
import { mountOfflineDecoder } from './ui/offlineDecoder';
mountBleLab(document.querySelector<HTMLElement>('#app')!);
mountOfflineDecoder(document.querySelector<HTMLElement>('#devtools')!);
// Offline support on the published site only (not on the local dev server).
if ('serviceWorker' in navigator && location.protocol === 'https:') void navigator.serviceWorker.register('./sw.js').catch(() => { /* the page works without it */ });
