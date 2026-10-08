import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  // Private identity / capture data lives in the project folder; never serve it over the LAN dev server.
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/RD545Private/**'] } },
});
