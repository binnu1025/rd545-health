import { afterEach, expect, it, vi } from 'vitest';
import { BleProbe } from '../src/bluetooth/BleProbe';

function fakeDevice(name: string, connects = true) {
  const device = Object.assign(new EventTarget(), { name, id: name, gatt: { connected: false, connect: vi.fn(async () => { if (!connects) throw Error('unreachable'); device.gatt.connected = true; return device.gatt; }), disconnect: vi.fn() } });
  return device;
}
function stubBluetooth(bluetooth: object) {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { bluetooth });
}
afterEach(() => vi.unstubAllGlobals());

it('reconnects to a scale the site was already allowed to use, without a chooser', async () => {
  const scale = fakeDevice('TNT_BW'), requestDevice = vi.fn();
  stubBluetooth({ getDevices: async () => [fakeDevice('Headphones'), scale], requestDevice });
  const probe = new BleProbe();
  await probe.connect(['svc'], 'TNT_BW');
  expect(requestDevice).not.toHaveBeenCalled();
  expect(probe.device).toBe(scale); expect(probe.status).toBe('Connected');
});
it('opens a chooser filtered to the scale when no device is remembered', async () => {
  const scale = fakeDevice('TNT_BW'), requestDevice = vi.fn(async () => scale);
  stubBluetooth({ requestDevice });
  await new BleProbe().connect(['svc'], 'TNT_BW');
  expect(requestDevice).toHaveBeenCalledWith({ filters: [{ namePrefix: 'TNT_BW' }], optionalServices: ['svc'] });
});
it('falls back to the chooser on the next tap when the remembered scale cannot be reached', async () => {
  const asleep = fakeDevice('TNT_BW', false), awake = fakeDevice('TNT_BW'), requestDevice = vi.fn(async () => awake);
  stubBluetooth({ getDevices: async () => [asleep], requestDevice });
  const probe = new BleProbe();
  await expect(probe.connect(['svc'], 'TNT_BW')).rejects.toThrow('再按一次');
  await probe.connect(['svc'], 'TNT_BW');
  expect(requestDevice).toHaveBeenCalledTimes(1); expect(probe.device).toBe(awake);
});
it('keeps listing every device for the diagnostic lab', async () => {
  const requestDevice = vi.fn(async () => fakeDevice('Anything'));
  stubBluetooth({ getDevices: async () => [fakeDevice('TNT_BW')], requestDevice });
  await new BleProbe().connect(['svc']);
  expect(requestDevice).toHaveBeenCalledWith({ acceptAllDevices: true, optionalServices: ['svc'] });
});
