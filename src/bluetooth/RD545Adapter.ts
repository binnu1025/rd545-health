import type { ScaleAdapter, MeasurementProfile } from './types';
export class RD545Adapter implements ScaleAdapter {
  async connect(): Promise<void> { throw new Error('RD-545 protocol not yet verified'); }
  async disconnect(): Promise<void> { throw new Error('RD-545 protocol not yet verified'); }
  async startMeasurement(_profile?: MeasurementProfile): Promise<void> { throw new Error('RD-545 protocol not yet verified'); }
  async stopMeasurement(): Promise<void> { throw new Error('RD-545 protocol not yet verified'); }
  subscribe(_callback: (measurement: unknown) => void): void { throw new Error('RD-545 protocol not yet verified'); }
}
