import { expect, it } from 'vitest';
import { identifyScale } from '../src/bluetooth/identityProbe';
import { birthCount } from '../src/bluetooth/userInfo';
import type { BleProbe } from '../src/bluetooth/BleProbe';
import { observedServiceUuid } from '../src/bluetooth/autoReceive';
import { candidateFields, ExperimentalAssembler } from '../src/bluetooth/experimentalDecoder';

// A simulated scale that keeps one stored profile (user 0); every value here is synthetic.
function scale(opts: { rejectMeasure?: boolean } = {}) {
  const stored = { birth: birthCount('1990-01-05'), sex: 0, height: 1700 };
  const original = { ...stored };
  const rx = Object.assign(new EventTarget(), { properties: { notify: true }, value: new DataView(new ArrayBuffer(0)) });
  const suffix = '-6b90-4779-83b8-b8bf1dadac35', rxKey = observedServiceUuid + '/273e510e' + suffix;
  const sent: number[] = [], assembler = new ExperimentalAssembler();
  const reply = (command: number, payload: number[], status = 0) => {
    const f = new Uint8Array(payload.length + 6); f[0] = (f.length - 2) >> 8; f[1] = (f.length - 2) & 255; f[2] = (command >> 8) | 128; f[3] = command & 255; f[4] = status; f.set(payload, 5);
    f[f.length - 1] = (255 - f.reduce((a, b) => a + b, 0)) & 255;
    for (let off = 0; off < f.length; off += 16) { const n = Math.min(16, f.length - off), p = new Uint8Array(20); p[0] = off >> 8; p[1] = off & 255; p[2] = Math.ceil(f.length / 16) - 1; p[3] = n; p.set(f.subarray(off, off + n), 4); rx.value = new DataView(p.buffer); rx.dispatchEvent(new Event('characteristicvaluechanged')); }
  };
  const profilePayload = () => [0x6a, 0x32, 0, 0, 0x6a, 0x33, 0, 0, 0, 0x7e, 0x22, 10, 84, 69, 83, 84, 0, 0, 0, 0, 0, 0,
    0x6a, 0x3c, stored.birth >> 8, stored.birth & 255, 0x6a, 0x37, stored.sex, 0x6a, 0x38, 0, 0x6a, 0x3e, stored.height >> 8, stored.height & 255,
    0x6a, 0x3b, 0, 0x60, 0x4f, 0, 0, 0x6a, 0x13, 7, 0x6a, 0x15, 0, 0, 0, 1];
  const result = () => { const f = new Uint8Array(346); f[0] = 1; f[1] = 88; f[2] = 0xb0; f[3] = 0x10; f[5] = 1; f.set([0x6a, 0x32, 0x26, 0x31, 0x6a, 0x33, 0, 0x2f, 0xba], 6);
    candidateFields.forEach((field, i) => { f[field.offset] = field.tag >> 8; f[field.offset + 1] = field.tag & 255; f[field.offset + 2] = 0; f[field.offset + 3] = 100 + i; });
    f[345] = (255 - f.reduce((a, b) => a + b, 0)) & 255; return [...f.subarray(4, 345)]; };
  const probe = { status: 'Connected', connectionGeneration: 1, device: new EventTarget(),
    characteristics: new Map<string, unknown>([[rxKey, rx], [observedServiceUuid + '/273e5107' + suffix, { properties: { writeWithoutResponse: true } }]]),
    subscriptions: new Map([[rxKey, () => {}]]),
    async write(_k: string, chunk: Uint8Array) {
      const req = assembler.push(chunk); if (!req) return;
      const command = req[2] * 256 + req[3]; sent.push(command);
      const body = req.subarray(4, req.length - 1);
      if (command === 0x1002) {
        // Store exactly what was sent for birth (6a3c), sex (6a37) and height (6a3e), then echo the stored profile.
        for (let i = 0; i < body.length - 1; i++) {
          const t = body[i] * 256 + body[i + 1];
          if (t === 0x6a3c) stored.birth = body[i + 2] * 256 + body[i + 3];
          if (t === 0x6a37) stored.sex = body[i + 2];
          if (t === 0x6a3e) stored.height = body[i + 2] * 256 + body[i + 3];
        }
        return reply(0x1002, profilePayload());
      }
      if (command === 0x1000) return reply(0x1000, profilePayload());
      if (command === 32) return reply(32, [...new TextEncoder().encode('RD-545AS')]);
      if (command === 0x2010) return reply(0x2010, [0], opts.rejectMeasure ? 4 : 0);
      if (command === 0x3000) return reply(0x3000, [1]);
      if (command === 0x3010) { const r = result(); const f = new Uint8Array(346); f.set([1, 88, 0xb0, 0x10], 0); f.set(r, 4); f[345] = (255 - f.reduce((a, b) => a + b, 0)) & 255;
        for (let off = 0; off < 346; off += 16) { const n = Math.min(16, 346 - off), p = new Uint8Array(20); p[0] = off >> 8; p[1] = off & 255; p[2] = 21; p[3] = n; p.set(f.subarray(off, off + n), 4); rx.value = new DataView(p.buffer); rx.dispatchEvent(new Event('characteristicvaluechanged')); } return; }
      return reply(command, [0]);
    },
  } as unknown as BleProbe;
  return { probe, sent, stored, original };
}
const uuid = '00000000-0000-4000-8000-000000000000';
const mom = { name: '媽媽', birthDate: '1960-03-15', sex: 'female' as const, heightCm: 158.5 };

it('measures a family member with their profile, then restores the owner exactly', async () => {
  const s = scale(); const seen: number[] = [];
  const text = await identifyScale(s.probe, uuid, true, () => {}, () => { seen.push(s.stored.height, s.stored.sex); }, { measureFor: mom });
  expect(s.sent).toEqual([3, 16, 32, 0x1000, 0x1002, 0x2010, 0x3000, 0x3010, 0x1002, 1]); // ends the session like the official app
  expect(seen).toEqual([1585, 1]);                  // during the measurement the scale held mom's height and sex
  expect(s.stored).toEqual(s.original);             // afterwards the owner's profile is back
  expect(text).not.toContain('還沒改回');
});
it('restores the owner even when the measurement itself fails', async () => {
  const s = scale({ rejectMeasure: true });
  await expect(identifyScale(s.probe, uuid, true, () => {}, () => {}, { measureFor: mom })).rejects.toThrow('開始測量');
  expect(s.sent.slice(-1)).toEqual([0x1002]);        // restored, and the connection is kept for a retry (no 0x0001)
  expect(s.stored).toEqual(s.original);
});
it('never writes a profile when the owner measures', async () => {
  const s = scale();
  await identifyScale(s.probe, uuid, true);
  expect(s.sent).not.toContain(0x1002);
});
