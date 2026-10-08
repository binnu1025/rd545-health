import { expect, it } from 'vitest';
import { decodeSetup, encodeSetup } from '../src/storage/deviceSetup';

const setup = { sheet: { url: 'https://script.google.com/macros/s/AKfy-test_123/exec', token: 'ab'.repeat(24) }, uuid: '00000000-0000-4000-8000-000000000000' };
it('round-trips spreadsheet settings and identity through one code', () => {
  const code = encodeSetup(setup);
  expect(code.startsWith('RD545SETUP1:')).toBe(true);
  expect(code).not.toMatch(/[+/=\s]/); // safe to copy from a QR scanner as one word
  expect(decodeSetup(`  ${code}\n`)).toEqual(setup);
});
it('rejects foreign, truncated or tampered codes', () => {
  expect(() => decodeSetup('hello')).toThrow('RD545SETUP1');
  expect(() => decodeSetup(encodeSetup(setup).slice(0, 30))).toThrow();
  expect(() => decodeSetup(encodeSetup({ ...setup, sheet: { ...setup.sheet, url: 'https://evil.example/exec' } }))).toThrow('內容不正確');
  expect(() => decodeSetup(encodeSetup({ ...setup, uuid: 'not-a-uuid' }))).toThrow('內容不正確');
});
it('turns the code into a scan-to-set-up link and clears it from the address bar after reading', async () => {
  const { setupLink, takeSetupFromLink } = await import('../src/storage/deviceSetup');
  const code = encodeSetup(setup);
  const fromLocalhost = setupLink(code, { protocol: 'http:', origin: 'http://localhost:5173', pathname: '/' } as Location);
  expect(fromLocalhost.startsWith('https://binnu1025.github.io/rd545-health/#setup=RD545SETUP1:')).toBe(true);
  const url = new URL(fromLocalhost);
  const replaced: string[] = [];
  const read = takeSetupFromLink({ hash: url.hash, pathname: url.pathname, search: '' } as Location, { replaceState: (_s: unknown, _t: string, u: string) => replaced.push(u) } as unknown as History);
  expect(read).toEqual(setup);
  expect(replaced).toEqual(['/rd545-health/']);
  expect(takeSetupFromLink({ hash: '', pathname: '/', search: '' } as Location, { replaceState: () => { throw Error('should not touch history'); } } as unknown as History)).toBeNull();
});
