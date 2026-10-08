import { expect, it, vi } from 'vitest';
import { autoReceive } from '../src/bluetooth/autoReceive';
import type { BleProbe } from '../src/bluetooth/BleProbe';
it('continues after authentication failure, skips writes and existing subscriptions', async () => {
  const toggle = vi.fn(async (key: string) => { if(key === 'a') throw new Error('Authentication failed'); });
  const probe = {
    characteristics: new Map([
      ['a', {uuid:'a',properties:{notify:true}}],
      ['b', {uuid:'b',properties:{writeWithoutResponse:true}}],
      ['c', {uuid:'c',properties:{notify:true}}],
      ['d', {uuid:'d',properties:{indicate:true}}],
    ]), subscriptions: new Map([['c',()=>{}]]), toggleNotifications: toggle,
  } as unknown as BleProbe;
  expect(await autoReceive(probe,()=>{})).toEqual(['a: Authentication failed']);
  expect(toggle.mock.calls.map(call=>call[0])).toEqual(['a','d']);
});
