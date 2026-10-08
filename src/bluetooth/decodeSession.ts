import { decodeExperimentalResult, ExperimentalAssembler } from './experimentalDecoder';
export function decodeSession(input: unknown) {
  const rows = Array.isArray(input) ? input : (input as {packets?: unknown})?.packets;
  if (!Array.isArray(rows) || rows.length > 100000) throw Error('請選擇 BLE Lab JSON 或已篩選的 ATT JSON（最多 100,000 筆）');
  const streams = new Map<string, ExperimentalAssembler>();
  const results: {timestamp: string; result: ReturnType<typeof decodeExperimentalResult>}[] = [];
  const errors: string[] = [];
  for (let i=0; i<rows.length; i++) {
    const row = rows[i];
    if (!row || row.direction !== 'RX') continue;
    let hex: string, key: string, timestamp: string;
    if (typeof row.hex === 'string') {
      if (!/^1b[0-9a-f]+$/i.test(row.hex)) continue;
      hex = row.hex.slice(6); key = `${row.handle}/${row.hex.slice(2,6)}`; timestamp = row.time;
    } else if (typeof row.payloadHex === 'string') {
      hex = row.payloadHex.replace(/\s/g,''); key = `${row.serviceUuid}/${row.characteristicUuid}`; timestamp = row.timestamp;
    } else { errors.push(`第 ${i+1} 筆缺少 HEX`); continue; }
    if (!/^(?:[0-9a-f]{2}){5,20}$/i.test(hex)) { errors.push(`第 ${i+1} 筆格式不符`); continue; }
    let assembler=streams.get(key); if(!assembler) {assembler=new ExperimentalAssembler();streams.set(key,assembler);}
    try {
      const frame = assembler.push(Uint8Array.from(hex.match(/../g)!,h=>parseInt(h,16)));
      if(frame && frame[2]===0xb0 && frame[3]===0x10) results.push({timestamp:typeof timestamp==='string'?timestamp:'',result:decodeExperimentalResult(frame)});
    } catch(error) { errors.push(`第 ${i+1} 筆：${error instanceof Error?error.message:String(error)}`); }
  }
  return {results, errors};
}
