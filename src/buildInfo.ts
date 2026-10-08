// Injected at build time by vite.config.ts (`define`).
declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;
declare const __BUILD_TIME__: string;

const taipeiDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)).replace(',', '');

export const buildInfo = {
  version: `v${__APP_VERSION__}`,
  build: __BUILD_ID__,
  /** Taipei time the site was built, e.g. "2026-10-08 15:20". */
  builtAt: taipeiDate(__BUILD_TIME__),
};
