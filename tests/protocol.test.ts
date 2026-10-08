import { describe, it, expect } from 'vitest';
import { PacketLogger, parseHex, parseServices } from '../src/bluetooth/packetLogger';
import { RD545Adapter } from '../src/bluetooth/RD545Adapter';
describe('packet integrity', () => {
  it('respects DataView offset and preserves raw bytes', () => {
    const logger = new PacketLogger();
    logger.add('RX','service','characteristic',new DataView(Uint8Array.from([255,0,65,164,255]).buffer,1,3));
    expect(logger.packets[0].payloadHex).toBe('00 41 A4');
    expect(logger.packets[0].payloadDecimal).toEqual([0,65,164]);
    expect(logger.packets[0].payloadAscii).toBe('.A.');
    expect(logger.csv()).toContain('"[0,65,164]"');
  });
  it('rejects malformed writes rather than silently truncating', () => {
    for (const input of ['', '0', '0x01', 'GG', 'AA,B0', '00'.repeat(513)]) expect(() => parseHex(input)).toThrow();
    expect([...parseHex('01 A4\n00')]).toEqual([1,164,0]);
  });
  it('accepts only explicitly supplied full service UUIDs', () => {
    expect(parseServices('')).toEqual([]);
    expect(() => parseServices('guessed-service')).toThrow();
    expect(parseServices('00000000-0000-0000-0000-000000000000')).toHaveLength(1);
  });
  it('bounds memory and discloses dropped records', () => {
    const logger = new PacketLogger();
    for(let i=0;i<10001;i++) logger.add('RX','s','c',new DataView(new ArrayBuffer(0)));
    expect(logger.packets).toHaveLength(10000); expect(logger.dropped).toBe(1);
    logger.clear(); expect(logger.packets).toHaveLength(0); expect(logger.dropped).toBe(0);
  });
  it('never reports unverified adapter success', async () => {
    const adapter = new RD545Adapter();
    for(const action of [() => adapter.connect(), () => adapter.disconnect(), () => adapter.startMeasurement(), () => adapter.stopMeasurement()]) await expect(action()).rejects.toThrow('RD-545 protocol not yet verified');
    expect(() => adapter.subscribe(() => {})).toThrow('RD-545 protocol not yet verified');
  });
});
