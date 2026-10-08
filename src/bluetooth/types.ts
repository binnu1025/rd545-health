export interface Packet { timestamp: string; direction: 'RX' | 'TX'; serviceUuid: string; characteristicUuid: string; payloadHex: string; payloadDecimal: number[]; payloadAscii: string }
export interface CharacteristicInfo { uuid: string; properties: string[] }
export interface ServiceInfo { uuid: string; characteristics: CharacteristicInfo[]; error?: string }
export interface MeasurementProfile { age: number; sex: string; heightCm: number; athleteMode?: boolean }
export interface ScaleAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  startMeasurement(profile?: MeasurementProfile): Promise<void>;
  stopMeasurement(): Promise<void>;
  subscribe(callback: (measurement: unknown) => void): void;
}
