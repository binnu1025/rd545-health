import type { BleProbe } from './BleProbe';
// Observed in the user's TNT_PAIR nRF Connect screenshot, 2026-10-07.
// This is evidence of a service, not verification of model or measurement protocol.
export const observedServiceUuid = '273e5100-6b90-4779-83b8-b8bf1dadac35';
export async function autoReceive(probe: BleProbe, progress: (text: string) => void) {
  const failures: string[] = [];
  for (const [key, characteristic] of probe.characteristics) {
    if (!characteristic.properties.notify && !characteristic.properties.indicate) continue;
    if (probe.subscriptions.has(key)) continue;
    progress(`正在啟用接收：${characteristic.uuid.slice(0, 8)}…`);
    try { await probe.toggleNotifications(key); }
    catch (error) { failures.push(`${characteristic.uuid}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return failures;
}
