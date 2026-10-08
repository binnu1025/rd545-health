import { PacketLogger } from './packetLogger';
import type { ServiceInfo } from './types';
export class BleProbe extends EventTarget {
  device?: BluetoothDevice;
  services: ServiceInfo[] = [];
  characteristics = new Map<string, BluetoothRemoteGATTCharacteristic>();
  subscriptions = new Map<string, EventListener>();
  logger = new PacketLogger();
  status: 'Disconnected' | 'Connecting' | 'Connected' = 'Disconnected';
  startedAt = new Date().toISOString();
  connectionGeneration = 0;
  private changed = () => this.dispatchEvent(new Event('change'));
  private disconnected = () => { this.cleanup(); this.status = 'Disconnected'; this.changed(); };
  private cleanup() {
    this.connectionGeneration++;
    this.subscriptions.forEach((handler, key) => this.characteristics.get(key)?.removeEventListener('characteristicvaluechanged', handler));
    this.subscriptions.clear(); this.characteristics.clear();
  }
  /**
   * With `namePrefix`, first tries a device this site was already allowed to use (no chooser at all, where the
   * browser supports getDevices), otherwise opens a chooser listing only devices with that name prefix.
   * Without it, the chooser lists every device (diagnostic lab).
   */
  async connect(optionalServices: string[], namePrefix?: string) {
    if (!navigator.bluetooth || !isSecureContext) throw new Error('需要支援 Web Bluetooth 的瀏覽器與 HTTPS（或 localhost）。');
    this.disconnect();
    this.status = 'Connecting'; this.changed();
    try {
      const known = namePrefix ? await this.knownDevice(namePrefix) : undefined;
      // Must run directly in a user gesture. No guessed service identifiers.
      const device = known ?? await navigator.bluetooth.requestDevice(namePrefix
        ? { filters: [{ namePrefix }], optionalServices } : { acceptAllDevices: true, optionalServices });
      this.device?.removeEventListener('gattserverdisconnected', this.disconnected);
      this.device = device; this.services = []; this.logger.clear(); this.startedAt = new Date().toISOString();
      device.addEventListener('gattserverdisconnected', this.disconnected);
      if (!device.gatt) throw new Error('此設備沒有可用的 GATT server。');
      const gatt = device.gatt;
      try {
        if (!known) await gatt.connect();
        else await Promise.race([gatt.connect(), new Promise((_, reject) => setTimeout(() => { gatt.disconnect(); reject(new Error('timeout')); }, 10000))]);
      }
      catch (error) {
        // A remembered device that is asleep or out of range: forget the shortcut for this visit so the next tap opens the chooser.
        if (known) { this.skipKnown = true; throw new Error('無法直接連上之前配對過的體脂計（可能還在休眠或不在附近）。請讓體脂計顯示畫面後再按一次，這次會出現選擇清單。'); }
        throw error;
      }
      this.status = 'Connected'; this.changed();
    } catch (error) { this.status = 'Disconnected'; this.changed(); throw error; }
  }
  private skipKnown = false;
  private async knownDevice(namePrefix: string): Promise<BluetoothDevice | undefined> {
    if (this.skipKnown || typeof navigator.bluetooth.getDevices !== 'function') return undefined;
    try { return (await navigator.bluetooth.getDevices()).find(d => d.name?.startsWith(namePrefix)); } catch { return undefined; }
  }
  disconnect() { this.device?.gatt?.disconnect(); this.cleanup(); this.status = 'Disconnected'; this.changed(); }
  async enumerate() {
    const server = this.device?.gatt;
    if (!server?.connected) throw new Error('請先連線。');
    if (this.subscriptions.size) throw new Error('請先取消所有通知訂閱再重新探索。');
    this.services = []; this.characteristics.clear();
    for (const service of await server.getPrimaryServices()) {
      const info: ServiceInfo = { uuid: service.uuid, characteristics: [] }; this.services.push(info);
      try {
        for (const c of await service.getCharacteristics()) {
          const key = service.uuid + '/' + c.uuid; this.characteristics.set(key, c);
          info.characteristics.push({ uuid: c.uuid, properties: (['read','write','writeWithoutResponse','notify','indicate'] as const).filter(p => c.properties[p]) });
        }
      } catch (error) { info.error = String(error); }
    }
    this.changed();
  }
  private get(key: string) {
    const c = this.characteristics.get(key);
    if (!c || !this.device?.gatt?.connected) throw new Error('連線已中斷，請重新連線並探索服務。');
    return c;
  }
  async read(key: string) {
    const c = this.get(key); const value = await c.readValue();
    this.logger.add('RX', c.service.uuid, c.uuid, value); this.changed();
  }
  async toggleNotifications(key: string) {
    const c = this.get(key); const old = this.subscriptions.get(key);
    if (old) { await c.stopNotifications(); c.removeEventListener('characteristicvaluechanged', old); this.subscriptions.delete(key); }
    else {
      const handler = () => { if (c.value) { this.logger.add('RX', c.service.uuid, c.uuid, c.value); this.changed(); } };
      c.addEventListener('characteristicvaluechanged', handler);
      try { await c.startNotifications(); this.subscriptions.set(key, handler); }
      catch (error) { c.removeEventListener('characteristicvaluechanged', handler); throw error; }
    }
    this.changed();
  }
  async write(key: string, bytes: Uint8Array, withoutResponse: boolean) {
    const c = this.get(key); const buffer = Uint8Array.from(bytes).buffer;
    if (withoutResponse) await c.writeValueWithoutResponse(buffer); else await c.writeValueWithResponse(buffer);
    this.logger.add('TX', c.service.uuid, c.uuid, new DataView(buffer)); this.changed();
  }
  session() {
    return { appVersion: '0.1.0', browser: navigator.userAgent, platform: navigator.platform, timestamp: this.startedAt,
      exportedAt: new Date().toISOString(), deviceName: this.device?.name ?? '', deviceId: this.device?.id ?? '',
      services: this.services, packets: this.logger.packets, droppedPacketCount: this.logger.dropped };
  }
}
