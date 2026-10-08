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
