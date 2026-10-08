import type { Packet } from './types';
export function parseHex(input: string): Uint8Array {
  const hex = input.replace(/\s/g, '');
  if (!hex || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) throw new Error('請輸入完整 HEX 位元組，例如 01 A4 00；不可包含 0x 或其他符號。');
  if (hex.length > 1024) throw new Error('單次寫入不可超過 512 bytes；設備可能有更小限制。');
  return Uint8Array.from(hex.match(/../g)!, byte => parseInt(byte, 16));
}
export function parseServices(input: string): string[] {
  const values = input.split(/[\s,;]+/).filter(Boolean).map(v => v.toLowerCase());
  if (values.some(v => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v))) throw new Error('Service UUID 請填完整 128-bit UUID，每行一筆。');
  return [...new Set(values)];
}
export class PacketLogger {
  packets: Packet[] = [];
  dropped = 0;
  add(direction: Packet['direction'], serviceUuid: string, characteristicUuid: string, value: DataView) {
    const bytes = [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)];
    const packet: Packet = { timestamp: new Date().toISOString(), direction, serviceUuid, characteristicUuid,
      payloadHex: bytes.map(v => v.toString(16).padStart(2, '0').toUpperCase()).join(' '), payloadDecimal: bytes,
      payloadAscii: bytes.map(v => v >= 32 && v <= 126 ? String.fromCharCode(v) : '.').join('') };
    if (this.packets.length >= 10000) { this.packets.shift(); this.dropped++; }
    this.packets.push(packet);
  }
  clear() { this.packets = []; this.dropped = 0; }
  csv(): string {
    const quote = (v: unknown) => '"' + String(v).replace(/"/g, '""') + '"';
    return '\uFEFF' + ['timestamp,direction,serviceUuid,characteristicUuid,payloadHex,payloadDecimal,payloadAscii', ...this.packets.map(p => [p.timestamp,p.direction,p.serviceUuid,p.characteristicUuid,p.payloadHex,JSON.stringify(p.payloadDecimal), /^[=+@-]/.test(p.payloadAscii) ? "'" + p.payloadAscii : p.payloadAscii].map(quote).join(','))].join('\r\n');
  }
}
