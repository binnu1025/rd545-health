import './styles/global.css';
import { mountBleLab } from './ui/bleLab';
import { mountOfflineDecoder } from './ui/offlineDecoder';
mountBleLab(document.querySelector<HTMLElement>('#app')!);
mountOfflineDecoder(document.querySelector<HTMLElement>('main')!);
