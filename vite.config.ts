import { defineConfig } from 'vite';
// Only the two variables below are read; the app itself is browser code, so Node typings are not installed.
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  base: './',
  // Version shown in the page header: npm supplies the package version, GitHub Actions the commit being deployed.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __BUILD_ID__: JSON.stringify((process.env.GITHUB_SHA ?? 'local').slice(0, 7)),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  // Private identity / capture data lives in the project folder; never serve it over the LAN dev server.
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/RD545Private/**'] } },
});
